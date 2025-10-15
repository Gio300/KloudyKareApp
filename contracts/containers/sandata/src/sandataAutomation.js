/**
 * Sandata Background Automation Service
 * Runs invisibly in background - submits EVV data automatically via browser automation
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class SandataAutomation {
  constructor(config) {
    this.config = {
      username: config.username || process.env.SANDATA_USERNAME,
      password: config.password || process.env.SANDATA_PASSWORD,
      portalUrl: 'https://evv.sandata.com/',
      headless: config.headless !== false, // Default to headless
      timeout: config.timeout || 60000,
      screenshotsEnabled: config.screenshots || false
    };
    
    this.browser = null;
    this.page = null;
    this.isLoggedIn = false;
  }

  /**
   * Initialize browser (runs once)
   */
  async initialize() {
    if (this.browser) return;
    
    this.browser = await puppeteer.launch({
      headless: this.config.headless ? 'new' : false,
      defaultViewport: { width: 1280, height: 800 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-position=-2400,-2400' // Off-screen
      ]
    });
    
    this.page = await this.browser.newPage();
    
    // Set user agent
    await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    console.log('[Sandata] Browser initialized (headless:', this.config.headless, ')');
  }

  /**
   * Login to Sandata portal
   */
  async login() {
    if (this.isLoggedIn) return true;
    
    try {
      await this.initialize();
      
      console.log('[Sandata] Logging in...');
      
      await this.page.goto(this.config.portalUrl, { 
        waitUntil: 'networkidle2',
        timeout: this.config.timeout 
      });
      
      // Wait for form
      await this.page.waitForSelector('input[name="password"]', { timeout: 30000 });
      
      // Fill form
      await this.page.type('input[placeholder="Enter Username"]', this.config.username);
      await this.page.type('input[placeholder="Enter Password"]', this.config.password);
      
      // Click login
      await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const loginBtn = buttons.find(b => b.textContent.trim() === 'LOGIN');
        if (loginBtn) loginBtn.click();
      });
      
      // Wait for navigation
      await this.page.waitForNavigation({ 
        waitUntil: 'networkidle2', 
        timeout: 30000 
      }).catch(() => {});
      
      await this.page.waitForTimeout(2000);
      
      const url = this.page.url();
      this.isLoggedIn = !url.includes('/login') || url.includes('dashboard');
      
      if (this.isLoggedIn) {
        console.log('[Sandata] ✅ Logged in');
      } else {
        console.log('[Sandata] ⚠️  Login may have failed');
      }
      
      return this.isLoggedIn;
      
    } catch (error) {
      console.error('[Sandata] Login error:', error.message);
      return false;
    }
  }

  /**
   * Navigate to NV-DHCFP upload page
   */
  async navigateToUpload() {
    try {
      console.log('[Sandata] Navigating to NV-DHCFP upload...');
      
      // Click Nevada link
      await this.page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const nvLink = links.find(l => l.textContent.includes('Nevada') || l.textContent.includes('NV-DHCFP'));
        if (nvLink) nvLink.click();
      });
      
      await this.page.waitForTimeout(2000);
      
      // Click upload/test files link
      await this.page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, button'));
        const uploadLink = links.find(l => 
          l.textContent?.includes('Upload') || 
          l.textContent?.includes('Test Files')
        );
        if (uploadLink) uploadLink.click();
      });
      
      await this.page.waitForTimeout(2000);
      
      console.log('[Sandata] ✅ On upload page');
      return true;
      
    } catch (error) {
      console.error('[Sandata] Navigation error:', error.message);
      return false;
    }
  }

  /**
   * Upload XML file
   */
  async uploadXML(xmlContent, filename) {
    try {
      await this.login();
      await this.navigateToUpload();
      
      console.log(`[Sandata] Uploading ${filename}...`);
      
      // Save XML to temp file
      const tempPath = path.join(__dirname, '../../../temp', filename);
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, xmlContent);
      
      // Find file input
      const fileInput = await this.page.$('input[type="file"]');
      
      if (!fileInput) {
        throw new Error('File input not found on page');
      }
      
      // Upload file
      await fileInput.uploadFile(tempPath);
      
      // Click submit
      await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const submitBtn = buttons.find(b => 
          b.textContent?.toLowerCase().includes('submit') ||
          b.textContent?.toLowerCase().includes('upload')
        );
        if (submitBtn) submitBtn.click();
      });
      
      // Wait for response
      await this.page.waitForTimeout(5000);
      
      // Extract UUID from response
      const result = await this.page.evaluate(() => {
        const bodyText = document.body.textContent;
        const uuidMatch = bodyText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        
        return {
          uuid: uuidMatch ? uuidMatch[0] : null,
          success: bodyText.includes('success') || bodyText.includes('received'),
          message: bodyText.substring(0, 200)
        };
      });
      
      // Clean up temp file
      fs.unlinkSync(tempPath);
      
      if (result.uuid) {
        console.log(`[Sandata] ✅ Uploaded - UUID: ${result.uuid}`);
        return { success: true, uuid: result.uuid };
      } else if (result.success) {
        console.log('[Sandata] ✅ Uploaded (no UUID)');
        return { success: true, message: result.message };
      } else {
        console.log('[Sandata] ⚠️  Upload result unclear');
        return { success: false, message: result.message };
      }
      
    } catch (error) {
      console.error('[Sandata] Upload error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Close browser
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.isLoggedIn = false;
      console.log('[Sandata] Browser closed');
    }
  }

  /**
   * Submit visit data (main production method)
   */
  async submitVisit(visitData) {
    // Transform visit data to Sandata XML
    const xml = this.buildVisitXML(visitData);
    
    // Upload via browser automation
    const result = await this.uploadXML(xml, `visit_${visitData.id}_${Date.now()}.xml`);
    
    return result;
  }

  /**
   * Build Sandata-compliant XML
   */
  buildVisitXML(visitData) {
    // Use your existing transformer
    const SandataTransformers = require('./dataTransformers');
    return SandataTransformers.transformVisit(visitData);
  }
}

module.exports = SandataAutomation;

