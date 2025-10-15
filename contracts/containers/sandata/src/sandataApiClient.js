/**
 * Sandata API Client - Automated Integration
 * Production-ready API client for EVV submissions
 */

const axios = require('axios');
const https = require('https');
const fs = require('fs');

class SandataApiClient {
  constructor(config) {
    this.config = {
      // API endpoints (will be provided by Sandata after certification)
      apiBaseUrl: config.apiBaseUrl || process.env.SANDATA_API_URL || 'https://api.sandata.com/evv/v1',
      
      // Credentials
      apiKey: config.apiKey || process.env.SANDATA_API_KEY,
      username: config.username || process.env.SANDATA_USERNAME,
      password: config.password || process.env.SANDATA_PASSWORD,
      
      // Provider info
      payerId: config.payerId || process.env.SANDATA_PAYER_ID || '71607',
      providerId: config.providerId || process.env.SANDATA_PROVIDER_ID || '951002550',
      
      // Timeouts
      timeout: config.timeout || 30000,
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 2000,
      
      // Sandbox mode
      sandbox: config.sandbox !== false
    };
    
    this.authToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Authenticate with Sandata API
   * Note: Exact auth method depends on Sandata's specification
   */
  async authenticate() {
    try {
      // Method 1: API Key (if provided post-certification)
      if (this.config.apiKey) {
        this.authToken = this.config.apiKey;
        return this.authToken;
      }
      
      // Method 2: OAuth2 token exchange
      const response = await axios.post(`${this.config.apiBaseUrl}/auth/token`, {
        grant_type: 'client_credentials',
        client_id: this.config.username,
        client_secret: this.config.password
      }, {
        timeout: this.config.timeout
      });
      
      this.authToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
      
      return this.authToken;
    } catch (error) {
      // Fallback: Use Basic Auth
      console.log('OAuth failed, using Basic Auth');
      this.authToken = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
      return this.authToken;
    }
  }

  /**
   * Ensure we have a valid auth token
   */
  async ensureAuthenticated() {
    if (!this.authToken || (this.tokenExpiry && Date.now() >= this.tokenExpiry)) {
      await this.authenticate();
    }
    return this.authToken;
  }

  /**
   * Submit XML data to Sandata
   */
  async submitXML(xmlData, options = {}) {
    await this.ensureAuthenticated();
    
    const headers = {
      'Content-Type': 'application/xml',
      'Accept': 'application/json',
      'X-Payer-ID': this.config.payerId,
      'X-Provider-ID': this.config.providerId
    };
    
    // Add authentication header
    if (this.config.apiKey) {
      headers['X-API-Key'] = this.authToken;
    } else {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    
    try {
      const response = await axios.post(
        `${this.config.apiBaseUrl}/submit`,
        xmlData,
        {
          headers,
          timeout: this.config.timeout,
          httpsAgent: new https.Agent({
            rejectUnauthorized: this.config.sandbox ? false : true
          })
        }
      );
      
      return {
        success: true,
        uuid: response.data.FileUUID || response.data.transactionId,
        message: response.data.message || 'Submitted successfully',
        data: response.data
      };
    } catch (error) {
      return this.handleError(error, 'submitXML');
    }
  }

  /**
   * Submit via multipart form (alternative method)
   */
  async submitFile(xmlContent, filename) {
    await this.ensureAuthenticated();
    
    const FormData = require('form-data');
    const form = new FormData();
    
    form.append('file', Buffer.from(xmlContent), {
      filename: filename || 'evv_data.xml',
      contentType: 'application/xml'
    });
    form.append('payerId', this.config.payerId);
    form.append('providerId', this.config.providerId);
    
    try {
      const response = await axios.post(
        `${this.config.apiBaseUrl}/upload`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Authorization': `Bearer ${this.authToken}`
          },
          timeout: this.config.timeout
        }
      );
      
      return {
        success: true,
        uuid: response.data.FileUUID || response.data.transactionId,
        data: response.data
      };
    } catch (error) {
      return this.handleError(error, 'submitFile');
    }
  }

  /**
   * Check status of a submission
   */
  async getStatus(uuid) {
    await this.ensureAuthenticated();
    
    try {
      const response = await axios.get(
        `${this.config.apiBaseUrl}/status/${uuid}`,
        {
          headers: {
            'Authorization': `Bearer ${this.authToken}`,
            'Accept': 'application/json'
          },
          timeout: this.config.timeout
        }
      );
      
      return {
        success: true,
        status: response.data.status,
        data: response.data
      };
    } catch (error) {
      return this.handleError(error, 'getStatus');
    }
  }

  /**
   * Submit with retry logic
   */
  async submitWithRetry(xmlData, options = {}) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        console.log(`Sandata submission attempt ${attempt}/${this.config.retryAttempts}`);
        
        const result = await this.submitXML(xmlData, options);
        
        if (result.success) {
          return result;
        }
        
        lastError = result.error;
        
        // Wait before retry
        if (attempt < this.config.retryAttempts) {
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * attempt));
        }
      } catch (error) {
        lastError = error;
        
        if (attempt < this.config.retryAttempts) {
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * attempt));
        }
      }
    }
    
    return {
      success: false,
      error: lastError,
      message: `Failed after ${this.config.retryAttempts} attempts`
    };
  }

  /**
   * Handle API errors
   */
  handleError(error, context) {
    console.error(`Sandata API error in ${context}:`, error.message);
    
    if (error.response) {
      return {
        success: false,
        error: error.response.data,
        status: error.response.status,
        message: error.response.data?.message || error.message
      };
    }
    
    return {
      success: false,
      error: error.message,
      message: `Network error: ${error.message}`
    };
  }

  /**
   * Validate connection
   */
  async testConnection() {
    try {
      await this.authenticate();
      
      // Try a simple ping/health check
      const response = await axios.get(
        `${this.config.apiBaseUrl}/health`,
        {
          headers: {
            'Authorization': `Bearer ${this.authToken}`
          },
          timeout: 10000,
          validateStatus: () => true
        }
      );
      
      return {
        success: response.status < 400,
        status: response.status,
        message: response.status < 400 ? 'Connection successful' : 'Connection failed'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Unable to connect to Sandata API'
      };
    }
  }
}

module.exports = SandataApiClient;

