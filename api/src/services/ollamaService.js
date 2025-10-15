/**
 * Ollama LLaMA 3.3 Integration Service
 * Handles communication with Ollama AI brain for generating responses
 */

const axios = require('axios');

class OllamaService {
  constructor(logger) {
    this.logger = logger;
    this.baseURL = process.env.OLLAMA_URL || 'http://ollama:11434';
    this.model = process.env.OLLAMA_MODEL || 'llama3.3:latest';
  }

  /**
   * Check if Ollama service is available and model is loaded
   */
  async isAvailable() {
    try {
        const response = await axios.get(`${this.baseURL}/api/tags`, {
          timeout: 5000,
          family: 4 // Force IPv4
        });
      
      const models = response.data.models || [];
      const hasModel = models.some(model => model.name.includes('llama3.3'));
      
      if (!hasModel) {
        this.logger.warn('LLaMA 3.3 model not found, attempting to pull...');
        await this.pullModel();
      }
      
      return true;
    } catch (error) {
      this.logger.error('Ollama service unavailable', { error: error.message });
      return false;
    }
  }

  /**
   * Pull LLaMA 3.3 model if not available
   */
  async pullModel() {
    try {
      this.logger.info('Pulling LLaMA 3.3 model...');
      
      const response = await axios.post(`${this.baseURL}/api/pull`, {
        name: this.model
      }, {
        timeout: 300000 // 5 minutes timeout for model download
      });
      
      this.logger.info('LLaMA 3.3 model pull initiated');
      return response.data;
    } catch (error) {
      this.logger.error('Failed to pull LLaMA 3.3 model', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate response using LLaMA 3.3
   */
  async generateResponse(prompt, context = {}) {
    try {
      const available = await this.isAvailable();
      if (!available) {
        throw new Error('Ollama service not available');
      }

      // Build system prompt with context
      const systemPrompt = this.buildSystemPrompt(context);
      
      const requestData = {
        model: this.model,
        prompt: prompt,
        system: systemPrompt,
        stream: false,
        options: {
          temperature: 0.3,
          top_p: 0.9,
          top_k: 40,
          num_predict: 500
        }
      };

      this.logger.debug('Sending request to Ollama', { 
        model: this.model,
        promptLength: prompt.length 
      });

        const response = await axios.post(`${this.baseURL}/api/generate`, requestData, {
          timeout: 30000, // 30 seconds timeout
          family: 4 // Force IPv4
        });

      if (response.data && response.data.response) {
        this.logger.info('Ollama response generated successfully', {
          responseLength: response.data.response.length,
          totalDuration: response.data.total_duration
        });
        
        return {
          success: true,
          response: response.data.response.trim(),
          model: this.model,
          stats: {
            totalDuration: response.data.total_duration,
            loadDuration: response.data.load_duration,
            promptEvalCount: response.data.prompt_eval_count,
            evalCount: response.data.eval_count
          }
        };
      } else {
        throw new Error('Invalid response from Ollama');
      }

    } catch (error) {
      this.logger.error('Ollama response generation failed', {
        error: error.message,
        model: this.model
      });
      
      return {
        success: false,
        error: error.message,
        fallback: true
      };
    }
  }

  /**
   * Build system prompt with healthcare context
   */
  buildSystemPrompt(context = {}) {
    const basePrompt = `You are a knowledgeable AI assistant for United Family Caregivers, a Nevada-licensed home care provider specializing in Personal Care Services (PCS) under Nevada Medicaid Type 30.

NEVADA MEDICAID PCS KNOWLEDGE:
- Nevada Medicaid Personal Care Services (PCS) Type 30 provides in-home care for eligible individuals
- Services include: personal care, homemaker services, companion care, respite care
- Eligibility requires Nevada Medicaid coverage and assessment showing need for assistance with Activities of Daily Living (ADLs)
- Common covered services: bathing, dressing, grooming, meal preparation, light housekeeping, medication reminders, transportation to medical appointments
- PCS services are typically authorized for specific hours per week/month based on individual need assessment
- Prior authorization required from Nevada Medicaid Division of Health Care Financing and Policy (DHCFP)
- Rate schedules and billing requirements follow Nevada Medicaid guidelines

YOUR ROLE:
- Help clients understand Nevada Medicaid PCS eligibility and benefits
- Explain United Family Caregivers services and how they align with Nevada Medicaid coverage
- Provide information about the application and authorization process
- Answer questions about covered services, hours, and billing
- Guide users through registration and account setup
- Offer customer service and support within scope

COMPANY INFORMATION:
- Company: NV Care Solutions Inc dba United Family Caregivers
- Nevada License: PCS Provider Type 30
- Phone: 833.432.6488
- Services: Personal Care, Homemaker Services, Companion Care, Respite Care
- Coverage Area: Nevada (statewide)

STRICT LIMITATIONS:
- You CANNOT provide medical advice, diagnosis, or treatment recommendations
- You CANNOT handle medical emergencies (direct users to call 911 immediately)
- You CANNOT access or discuss other clients' private information
- You CANNOT provide legal advice or make eligibility determinations
- You CANNOT guarantee coverage or approval - only Nevada Medicaid can make final determinations

RESPONSE GUIDELINES:
- Stay focused on United Family Caregivers services and Nevada Medicaid PCS
- Keep responses concise and helpful (under 250 words)
- Use professional, compassionate, and knowledgeable tone
- Provide specific next steps when possible
- Include contact information for complex issues: 833.432.6488
- Ask clarifying questions to better assist users
- Always mention that final eligibility and coverage decisions are made by Nevada Medicaid`;

    // Add context-specific information
    if (context.userProfile) {
      return basePrompt + `\n\nCURRENT USER CONTEXT:\n- User: ${context.userProfile.name || 'Unknown'}\n- Status: ${context.userProfile.status || 'New user'}`;
    }

    if (context.currentSection) {
      return basePrompt + `\n\nCURRENT SECTION: User is viewing ${context.currentSection} section`;
    }

    return basePrompt;
  }

  /**
   * Analyze user intent using LLaMA 3.3
   */
  async analyzeIntent(message) {
    try {
      const intentPrompt = `Analyze the user's intent from this message and respond with ONLY one of these categories:
      
CATEGORIES:
- profile_inquiry: User wants to see/update their profile information
- eligibility_check: User wants to check eligibility or coverage
- visit_inquiry: User asking about visits, appointments, or caregivers
- billing_inquiry: User asking about bills, payments, or costs
- general_help: User needs general help or information
- emergency: User has an emergency situation
- out_of_scope: Request is outside of home care services

MESSAGE: "${message}"

Respond with ONLY the category name, nothing else.`;

      const response = await this.generateResponse(intentPrompt);
      
      if (response.success) {
        const intent = response.response.toLowerCase().trim();
        return intent;
      } else {
        // Fallback to basic keyword matching
        return this.fallbackIntentAnalysis(message);
      }
    } catch (error) {
      this.logger.error('Intent analysis failed', { error: error.message });
      return this.fallbackIntentAnalysis(message);
    }
  }

  /**
   * Fallback intent analysis using keywords
   */
  fallbackIntentAnalysis(message) {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('emergency') || lowerMessage.includes('911') || lowerMessage.includes('urgent')) {
      return 'emergency';
    }
    if (lowerMessage.includes('profile') || lowerMessage.includes('my info')) {
      return 'profile_inquiry';
    }
    if (lowerMessage.includes('eligible') || lowerMessage.includes('coverage') || lowerMessage.includes('medicaid')) {
      return 'eligibility_check';
    }
    if (lowerMessage.includes('visit') || lowerMessage.includes('appointment') || lowerMessage.includes('caregiver')) {
      return 'visit_inquiry';
    }
    if (lowerMessage.includes('bill') || lowerMessage.includes('payment') || lowerMessage.includes('cost')) {
      return 'billing_inquiry';
    }
    if (lowerMessage.includes('help') || lowerMessage.includes('assistance')) {
      return 'general_help';
    }
    
    return 'general_help';
  }

  /**
   * Get model information
   */
  async getModelInfo() {
    try {
      const response = await axios.get(`${this.baseURL}/api/tags`);
      const models = response.data.models || [];
      const llamaModel = models.find(model => model.name.includes('llama3.3'));
      
      return {
        available: !!llamaModel,
        model: llamaModel,
        allModels: models.map(m => ({ name: m.name, size: m.size }))
      };
    } catch (error) {
      this.logger.error('Failed to get model info', { error: error.message });
      return { available: false, error: error.message };
    }
  }
}

module.exports = OllamaService;
