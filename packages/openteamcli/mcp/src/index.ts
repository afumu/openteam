#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DEFAULT_PORT = 19305;
const DEFAULT_TOKEN_PATH = resolve(homedir(), ".openteam/control-token");
const DEFAULT_COMMAND_TIMEOUT_MS = 300_000;

function readToken(): string {
  const tokenPath = DEFAULT_TOKEN_PATH;
  if (!existsSync(tokenPath)) {
    throw new Error(
      `OpenTeam 控制令牌文件不存在：${tokenPath}。请先运行 openteamcli daemon start 生成令牌。`
    );
  }
  const token = readFileSync(tokenPath, "utf8").trim();
  if (!token) {
    throw new Error(
      `OpenTeam 控制令牌为空：${tokenPath}。请先运行 openteamcli daemon start 重新生成。`
    );
  }
  return token;
}

function controlPort(): number {
  const parsed = Number(process.env.OPENTEAM_DAEMON_PORT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

function controlUrl(path: string): string {
  return `http://127.0.0.1:${controlPort()}${path}`;
}

async function daemonGet(path: string): Promise<unknown> {
  const response = await fetch(controlUrl(path));
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    throw new Error(
      body?.error
        ? String((body.error as Record<string, unknown>).message ?? `请求失败：HTTP ${response.status}`)
        : `请求失败：HTTP ${response.status}`
    );
  }
  return response.json();
}

async function daemonPost(
  path: string,
  body?: unknown
): Promise<unknown> {
  const token = readToken();
  const response = await fetch(controlUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OpenTeam": "1",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error = data?.error as Record<string, unknown> | undefined;
    throw new Error(
      error?.message
        ? String(error.message)
        : `请求失败：HTTP ${response.status}`
    );
  }
  return data;
}

async function sendCommand(
  action: string,
  payload?: unknown,
  timeoutMs?: number
): Promise<unknown> {
  const result = (await daemonPost("/command", {
    id: `mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    action,
    payload,
    timeoutMs: timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
  })) as Record<string, unknown>;
  if (!result.ok) {
    const error = result.error as Record<string, unknown> | undefined;
    throw new Error(
      error?.message
        ? String(error.message)
        : `命令 ${action} 执行失败`
    );
  }
  return result.data;
}

function textResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

const server = new McpServer({
  name: "openteam-daemon",
  version: "0.1.0",
});

server.tool(
  "openteam_ping",
  "检查 OpenTeam 本地 daemon 是否可达。无需认证。",
  {},
  async () => {
    const data = await daemonGet("/ping");
    return textResult(data);
  }
);

server.tool(
  "openteam_status",
  "获取 OpenTeam 本地 daemon 运行状态，包括 PID、运行时间、扩展连接状态等。无需认证。",
  {},
  async () => {
    const data = await daemonGet("/status");
    return textResult(data);
  }
);

server.tool(
  "openteam_doctor",
  "诊断 OpenTeam 本地 daemon 和 Chrome 扩展的连接状态。先检查 daemon 是否可达，再检查扩展是否已连接。",
  {},
  async () => {
    try {
      const status = (await daemonGet("/status")) as Record<string, unknown>;
      return textResult({
        ok: Boolean(status.ok && status.extensionConnected),
        daemon: {
          reachable: Boolean(status.ok),
          port: status.port,
          pid: status.pid,
        },
        extension: {
          connected: Boolean(status.extensionConnected),
          version: status.extensionVersion,
          protocolVersion: status.protocolVersion,
          profiles: status.profiles ?? [],
        },
        hint: status.extensionConnected
          ? undefined
          : '请打开 OpenTeam 插件页面，在设置里开启"本机智能体控制"。',
      });
    } catch (error) {
      return textResult({
        ok: false,
        daemon: { reachable: false },
        hint: `Daemon 不可达：${error instanceof Error ? error.message : String(error)}。请先运行 openteamcli daemon start。`,
      });
    }
  }
);

server.tool(
  "openteam_chat_list",
  "列出所有 OpenTeam 群聊的摘要信息，包括名称、状态、角色数、消息数等。",
  {},
  async () => {
    const data = await sendCommand("chat.list");
    return textResult(data);
  }
);

server.tool(
  "openteam_chat_get",
  "获取指定群聊的详细信息，包括角色列表和消息历史。",
  {
    chatId: z.string().describe("群聊 ID"),
  },
  async ({ chatId }) => {
    const data = await sendCommand("chat.get", { chatId });
    return textResult(data);
  }
);

server.tool(
  "openteam_chat_create",
  "创建一个新的 OpenTeam 群聊。",
  {
    name: z.string().describe("群聊名称"),
    description: z
      .string()
      .optional()
      .describe("群聊描述"),
    mode: z
      .enum(["collaborative", "independent"])
      .optional()
      .describe(
        "群聊模式：collaborative（协作模式，角色共享上下文）或 independent（独立模式，角色各自独立回复）"
      ),
  },
  async ({ name, description, mode }) => {
    const data = await sendCommand("chat.create", {
      name,
      description,
      mode,
    });
    return textResult(data);
  }
);

server.tool(
  "openteam_chat_activate",
  "激活指定的群聊，使其成为当前活跃群聊并打开 OpenTeam 页面。",
  {
    chatId: z.string().describe("要激活的群聊 ID"),
  },
  async ({ chatId }) => {
    const data = await sendCommand("chat.activate", { chatId });
    return textResult(data);
  }
);

server.tool(
  "openteam_chat_initialize",
  "初始化群聊，等待所有角色就绪。会先激活群聊，然后轮询直到所有角色准备完毕或超时。",
  {
    chatId: z.string().describe("群聊 ID"),
    waitForReady: z
      .boolean()
      .optional()
      .describe("是否等待所有角色就绪（默认 true）"),
    timeoutMs: z
      .number()
      .optional()
      .describe("等待角色就绪的超时时间（毫秒），默认 120000"),
  },
  async ({ chatId, waitForReady, timeoutMs }) => {
    const data = await sendCommand("chat.initialize", {
      chatId,
      waitForReady,
      timeoutMs,
    });
    return textResult(data);
  }
);

server.tool(
  "openteam_roles_batch_add",
  "向指定群聊批量添加角色。每个角色可以是人员库模板或临时角色。",
  {
    chatId: z.string().describe("群聊 ID"),
    items: z
      .array(
        z.object({
          source: z
            .enum(["temporary"])
            .optional()
            .describe("角色来源，temporary 表示临时角色"),
          name: z.string().describe("角色名称"),
          description: z
            .string()
            .optional()
            .describe("角色描述"),
          chatSite: z
            .enum(["deepseek", "chatgpt", "gemini", "claude", "grok"])
            .optional()
            .describe("角色使用的 AI 站点"),
          systemPrompt: z
            .string()
            .optional()
            .describe("角色的系统提示词"),
        })
      )
      .describe("要添加的角色列表"),
  },
  async ({ chatId, items }) => {
    const data = await sendCommand("roles.batchAdd", { chatId, items });
    return textResult(data);
  }
);

server.tool(
  "openteam_task_post",
  "向指定群聊发布任务消息，可以指定目标角色或发送给所有人。",
  {
    chatId: z.string().describe("群聊 ID"),
    content: z.string().describe("任务内容"),
    target: z
      .union([
        z.literal("all"),
        z.object({ roleIds: z.array(z.string()) }),
        z.object({ roleNames: z.array(z.string()) }),
      ])
      .optional()
      .describe(
        '任务目标：all（所有人）、{ roleIds: [...] }（按角色 ID）或 { roleNames: [...] }（按角色名称）。默认 all'
      ),
  },
  async ({ chatId, content, target }) => {
    const data = await sendCommand("task.post", {
      chatId,
      content,
      target: target ?? "all",
    });
    return textResult(data);
  }
);

server.tool(
  "openteam_task_read",
  "读取指定任务消息的执行结果，包括各角色的回复状态和内容。",
  {
    chatId: z.string().describe("群聊 ID"),
    messageId: z.string().describe("任务消息 ID"),
  },
  async ({ chatId, messageId }) => {
    const data = await sendCommand("task.read", { chatId, messageId });
    return textResult(data);
  }
);

server.tool(
  "openteam_task_wait",
  "等待指定任务消息完成，直到所有目标角色回复或超时。会轮询任务状态直到完成。",
  {
    chatId: z.string().describe("群聊 ID"),
    messageId: z.string().describe("任务消息 ID"),
    timeoutMs: z
      .number()
      .optional()
      .describe("等待超时时间（毫秒），默认 300000（5 分钟）"),
  },
  async ({ chatId, messageId, timeoutMs }) => {
    const data = await sendCommand(
      "task.wait",
      { chatId, messageId, timeoutMs },
      timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
    );
    return textResult(data);
  }
);

server.tool(
  "openteam_run_create_and_post",
  "一键创建群聊、添加角色、发布任务并等待回复。这是最便捷的操作方式，适合一次性完成整个流程。",
  {
    chat: z
      .object({
        name: z.string().optional().describe("群聊名称"),
        description: z.string().optional().describe("群聊描述"),
        mode: z
          .enum(["collaborative", "independent"])
          .optional()
          .describe("群聊模式"),
        reuse: z
          .object({
            strategy: z
              .enum(["none", "by-id", "by-name"])
              .optional()
              .describe("复用策略：none（创建新群聊）、by-id（按 ID 复用）、by-name（按名称复用）"),
            chatId: z.string().optional().describe("by-id 策略的群聊 ID"),
          })
          .optional()
          .describe("群聊复用配置"),
      })
      .describe("群聊配置"),
    roles: z
      .array(
        z.object({
          source: z
            .enum(["temporary"])
            .optional()
            .describe("角色来源，temporary 表示临时角色"),
          name: z.string().describe("角色名称"),
          description: z.string().optional().describe("角色描述"),
          chatSite: z
            .enum(["deepseek", "chatgpt", "gemini", "claude", "grok"])
            .optional()
            .describe("角色使用的 AI 站点"),
          systemPrompt: z.string().optional().describe("角色的系统提示词"),
        })
      )
      .optional()
      .describe("要添加的角色列表"),
    task: z
      .object({
        content: z.string().describe("任务内容"),
        target: z
          .union([
            z.literal("all"),
            z.object({ roleIds: z.array(z.string()) }),
            z.object({ roleNames: z.array(z.string()) }),
          ])
          .optional()
          .describe("任务目标，默认 all"),
      })
      .describe("任务配置"),
    options: z
      .object({
        waitForReplies: z
          .boolean()
          .optional()
          .describe("是否等待所有角色回复（默认 false）"),
        activateChat: z
          .boolean()
          .optional()
          .describe("是否激活群聊（默认 true）"),
        openTeamPage: z
          .boolean()
          .optional()
          .describe("是否打开 OpenTeam 页面（默认 true）"),
        timeoutMs: z
          .number()
          .optional()
          .describe("等待回复的超时时间（毫秒）"),
      })
      .optional()
      .describe("运行选项"),
  },
  async ({ chat, roles, task, options }) => {
    const data = await sendCommand(
      "run.createAndPost",
      { chat, roles, task, options },
      options?.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
    );
    return textResult(data);
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(
    "OpenTeam MCP Server 启动失败：",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
