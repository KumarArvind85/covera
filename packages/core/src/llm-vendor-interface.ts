/**
 * Layer 2: LLM-Agnostic Abstractions
 * 
 * This module defines the vendor-neutral interfaces that allow Covera
 * to work with OpenAI, Anthropic, Google, local models, etc. without
 * rewriting orchestration logic.
 */

/**
 * Unified LLM Vendor Interface
 * All vendors must implement this contract
 */
export interface ILLMVendor {
  name: string;
  apiBaseUrl: string;
  apiKey: string;

  /**
   * Call LLM with tool-calling support
   * Response is normalized to OpenAI's format for internal consistency
   */
  call(params: LLMCallParams): Promise<LLMResponse>;

  /**
   * Validate vendor-specific configuration at startup
   */
  validateConfig(): Promise<void>;
}

/**
 * Unified request shape for all vendors
 */
export interface LLMCallParams {
  model: string;
  systemPrompt: string;
  userMessage: string;
  tools?: MCPTool[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
}

/**
 * Normalized response from any vendor
 */
export interface LLMResponse {
  id: string;
  model: string;
  content: string;
  toolCalls?: ToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Tool call representation (normalized across vendors)
 */
export interface ToolCall {
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
}

/**
 * MCP Tool Schema (standardized across all vendors)
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Result of a tool execution via MCP
 */
export interface ToolExecutionResult {
  toolUseId: string;
  toolName: string;
  content: string;
  isError: boolean;
}

/**
 * Vendor Factory: Instantiate the correct vendor implementation
 */
export class VendorFactory {
  static createVendor(vendorConfig: VendorConfig): ILLMVendor {
    const vendorName = vendorConfig.provider.toLowerCase();

    switch (vendorName) {
      case "openai":
        return new OpenAIVendor(vendorConfig);
      case "anthropic":
        return new AnthropicVendor(vendorConfig);
      case "google":
        return new GoogleVendor(vendorConfig);
      case "local":
        return new LocalVendor(vendorConfig);
      default:
        throw new Error(`Unsupported LLM vendor: ${vendorName}`);
    }
  }
}

export interface VendorConfig {
  provider: "openai" | "anthropic" | "google" | "local";
  apiKey: string;
  apiBaseUrl?: string;
  model?: string;
}

/**
 * OpenAI Implementation
 */
export class OpenAIVendor implements ILLMVendor {
  name = "openai";
  apiBaseUrl = "https://api.openai.com/v1";
  apiKey: string;

  constructor(config: VendorConfig) {
    this.apiKey = config.apiKey;
    if (config.apiBaseUrl) this.apiBaseUrl = config.apiBaseUrl;
  }

  async call(params: LLMCallParams): Promise<LLMResponse> {
    // OpenAI uses standard tool-calling format
    const response = await fetch(`${this.apiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model || "gpt-4-turbo",
        messages: [
          { role: "system", content: params.systemPrompt },
          { role: "user", content: params.userMessage },
        ],
        tools: params.tools?.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
        temperature: params.temperature || 0.7,
        max_tokens: params.maxTokens || 2048,
      }),
    });

    const data = await response.json() as any;

    return {
      id: data.id,
      model: data.model,
      content: data.choices[0].message.content || "",
      toolCalls: (data.choices[0].message.tool_calls || []).map(
        (tc: any) => ({
          toolName: tc.function.name,
          toolUseId: tc.id,
          input: JSON.parse(tc.function.arguments),
        })
      ),
      stopReason: this.mapOpenAIStopReason(data.choices[0].finish_reason),
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      },
    };
  }

  private mapOpenAIStopReason(
    reason: string
  ): "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" {
    switch (reason) {
      case "tool_calls":
        return "tool_use";
      case "length":
        return "max_tokens";
      case "stop":
        return "stop_sequence";
      default:
        return "end_turn";
    }
  }

  async validateConfig(): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!response.ok) {
      throw new Error("Invalid OpenAI API key or unreachable endpoint");
    }
  }
}

/**
 * Anthropic Implementation (Claude)
 */
export class AnthropicVendor implements ILLMVendor {
  name = "anthropic";
  apiBaseUrl = "https://api.anthropic.com/v1";
  apiKey: string;

  constructor(config: VendorConfig) {
    this.apiKey = config.apiKey;
    if (config.apiBaseUrl) this.apiBaseUrl = config.apiBaseUrl;
  }

  async call(params: LLMCallParams): Promise<LLMResponse> {
    // Anthropic uses different tool format; normalize it internally
    const response = await fetch(`${this.apiBaseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: params.model || "claude-opus",
        max_tokens: params.maxTokens || 2048,
        system: params.systemPrompt,
        messages: [{ role: "user", content: params.userMessage }],
        tools: params.tools?.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        })),
      }),
    });

    const data = await response.json() as any;

    // Extract tool calls from Claude's response format
    const toolCalls = data.content
      .filter((block: any) => block.type === "tool_use")
      .map((block: any) => ({
        toolName: block.name,
        toolUseId: block.id,
        input: block.input,
      }));

    const textContent = data.content
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("\n");

    return {
      id: data.id,
      model: data.model,
      content: textContent,
      toolCalls,
      stopReason: this.mapClaudeStopReason(data.stop_reason),
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      },
    };
  }

  private mapClaudeStopReason(
    reason: string
  ): "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" {
    switch (reason) {
      case "tool_use":
        return "tool_use";
      case "max_tokens":
        return "max_tokens";
      case "stop_sequence":
        return "stop_sequence";
      default:
        return "end_turn";
    }
  }

  async validateConfig(): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/models`, {
      headers: { "x-api-key": this.apiKey },
    });
    if (!response.ok) {
      throw new Error("Invalid Anthropic API key or unreachable endpoint");
    }
  }
}

/**
 * Google Gemini Implementation
 */
export class GoogleVendor implements ILLMVendor {
  name = "google";
  apiBaseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
  apiKey: string;

  constructor(config: VendorConfig) {
    this.apiKey = config.apiKey;
  }

  async call(params: LLMCallParams): Promise<LLMResponse> {
    // Google Gemini API endpoint
    const model = params.model || "gemini-pro";
    const response = await fetch(
      `${this.apiBaseUrl}/${model}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: params.userMessage }] },
          ],
          tools:
            (params.tools?.length ?? 0) > 0
              ? [
                  {
                    functionDeclarations: (params.tools ?? []).map((tool) => ({
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.inputSchema,
                    })),
                  },
                ]
              : undefined,
          generationConfig: {
            temperature: params.temperature || 0.7,
            maxOutputTokens: params.maxTokens || 2048,
          },
          systemInstruction: { parts: [{ text: params.systemPrompt }] },
        }),
      }
    );

    const data = await response.json() as any;
    const content = data.candidates[0].content;

    // Extract tool calls from Google's format
    const toolCalls = (content.parts || [])
      .filter((part: any) => part.functionCall)
      .map((part: any) => ({
        toolName: part.functionCall.name,
        toolUseId: `google-${Date.now()}`, // Google doesn't return tool IDs
        input: part.functionCall.args || {},
      }));

    const textContent = (content.parts || [])
      .filter((part: any) => part.text)
      .map((part: any) => part.text)
      .join("\n");

    return {
      id: data.candidates[0].index?.toString() || "0",
      model,
      content: textContent,
      toolCalls,
      stopReason: this.mapGoogleStopReason(
        data.candidates[0].finishReason
      ),
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
      },
    };
  }

  private mapGoogleStopReason(
    reason: string
  ): "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" {
    switch (reason) {
      case "FUNCTION_CALLING":
        return "tool_use";
      case "MAX_TOKENS":
        return "max_tokens";
      case "STOP":
        return "stop_sequence";
      default:
        return "end_turn";
    }
  }

  async validateConfig(): Promise<void> {
    const response = await fetch(
      `${this.apiBaseUrl}?key=${this.apiKey}`
    );
    if (!response.ok) {
      throw new Error("Invalid Google API key or unreachable endpoint");
    }
  }
}

/**
 * Local Model Implementation (Ollama, vLLM, etc.)
 */
export class LocalVendor implements ILLMVendor {
  name = "local";
  apiBaseUrl: string;
  apiKey: string;

  constructor(config: VendorConfig) {
    this.apiBaseUrl = config.apiBaseUrl || "http://localhost:8000";
    this.apiKey = config.apiKey || "local";
  }

  async call(params: LLMCallParams): Promise<LLMResponse> {
    // Assumes OpenAI-compatible interface (Ollama, vLLM, LM Studio)
    const response = await fetch(`${this.apiBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: params.model || "mistral:7b",
        messages: [
          { role: "system", content: params.systemPrompt },
          { role: "user", content: params.userMessage },
        ],
        tools: params.tools?.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
        temperature: params.temperature || 0.7,
        max_tokens: params.maxTokens || 2048,
      }),
    });

    const data = await response.json() as any;

    return {
      id: data.id || `local-${Date.now()}`,
      model: params.model || "local-model",
      content: data.choices[0].message.content || "",
      toolCalls: (data.choices[0].message.tool_calls || []).map(
        (tc: any) => ({
          toolName: tc.function.name,
          toolUseId: tc.id,
          input: JSON.parse(tc.function.arguments),
        })
      ),
      stopReason: "end_turn",
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
    };
  }

  async validateConfig(): Promise<void> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/v1/models`);
      if (!response.ok) {
        throw new Error("Local LLM server not reachable or misconfigured");
      }
    } catch (error) {
      throw new Error(
        `Cannot connect to local LLM at ${this.apiBaseUrl}: ${error}`
      );
    }
  }
}

function fetch(
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<{ ok: boolean; json(): Promise<any> }> {
  const runtimeGlobal = globalThis as unknown as { fetch?: typeof fetch };
  if (typeof runtimeGlobal.fetch !== "function") {
    throw new Error("Fetch API is not available in this runtime");
  }

  return runtimeGlobal.fetch(input, init);
}

