import type { IMCPHost, RepositoryProfile, ToolExecutionResult } from "@covera/core";

export type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

export interface McpHostOptions {
  profileRepository: (repoPath: string) => Promise<RepositoryProfile>;
}

/**
 * In-process MCP host: routes executeTool(server, tool) to registered handlers.
 * Unregistered servers/tools return an error result instead of fake data.
 */
export class McpHost implements IMCPHost {
  private readonly servers = new Map<string, Record<string, ToolHandler>>();
  private callCount = 0;

  constructor(private readonly options: McpHostOptions) {}

  registerServer(name: string, tools: Record<string, ToolHandler>): this {
    this.servers.set(name, tools);
    return this;
  }

  async executeTool(
    serverName: string,
    request: { toolName: string; input: Record<string, unknown> }
  ): Promise<ToolExecutionResult> {
    const toolUseId = `${serverName}.${request.toolName}#${++this.callCount}`;
    const result = (content: string, isError: boolean): ToolExecutionResult => ({
      toolUseId,
      toolName: request.toolName,
      content,
      isError,
    });

    const handler = this.servers.get(serverName)?.[request.toolName];
    if (!handler) {
      return result(`No MCP tool registered: ${serverName}/${request.toolName}`, true);
    }

    try {
      return result(JSON.stringify(await handler(request.input)), false);
    } catch (error) {
      return result(error instanceof Error ? error.message : String(error), true);
    }
  }

  profileRepository(repoPath: string): Promise<RepositoryProfile> {
    return this.options.profileRepository(repoPath);
  }
}
