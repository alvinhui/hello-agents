import OpenAI from "openai";
import axios from "axios";
import { HelloAgentsLLM } from "./llm_client";

// ==================== 工具系统 ====================

type ToolFunction = (input: string) => Promise<string> | string;

interface ToolInfo {
  description: string;
  func: ToolFunction;
}

class ToolExecutor {
  private tools: Record<string, ToolInfo> = {};

  registerTool(name: string, description: string, func: ToolFunction): void {
    if (this.tools[name]) {
      console.log(`警告：工具 '${name}' 已存在，将被覆盖。`);
    }
    this.tools[name] = { description, func };
    console.log(`工具 '${name}' 已注册。`);
  }

  getTool(name: string): ToolFunction | undefined {
    return this.tools[name]?.func;
  }

  getAvailableTools(): string {
    return Object.entries(this.tools)
      .map(([name, info]) => `- ${name}: ${info.description}`)
      .join("\n");
  }
}

async function search(query: string): Promise<string> {
  console.log(`🔍 正在执行 [SerpApi] 网页搜索: ${query}`);
  try {
    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) {
      return "错误：SERPAPI_API_KEY 未在 .env 文件中配置。";
    }

    const { data: results } = await axios.get(
      "https://serpapi.com/search.json",
      {
        params: {
          engine: "google",
          q: query,
          api_key: apiKey,
          gl: "cn",
          hl: "zh-cn",
        },
      }
    );

    if (results.answer_box_list) {
      return results.answer_box_list.join("\n");
    }
    if (results.answer_box?.answer) {
      return results.answer_box.answer;
    }
    if (results.knowledge_graph?.description) {
      return results.knowledge_graph.description;
    }
    if (results.organic_results?.length) {
      return results.organic_results
        .slice(0, 3)
        .map(
          (res: any, i: number) =>
            `[${i + 1}] ${res.title ?? ""}\n${res.snippet ?? ""}`
        )
        .join("\n\n");
    }

    return `对不起，没有找到关于 '${query}' 的信息。`;
  } catch (e: any) {
    return `搜索时发生错误: ${e.message}`;
  }
}

// ==================== ReAct Agent ====================

const REACT_PROMPT_TEMPLATE = `
请注意，你是一个有能力调用外部工具的智能助手。

可用工具如下：
{tools}

请严格按照以下格式进行回应：

Thought: 你的思考过程，用于分析问题、拆解任务和规划下一步行动。
Action: 你决定采取的行动，必须是以下格式之一：
- \`{tool_name}[{tool_input}]\`：调用一个可用工具。
- \`Finish[最终答案]\`：当你认为已经获得最终答案时。
- 当你收集到足够的信息，能够回答用户的最终问题时，你必须在\`Action:\`字段后使用 \`Finish[最终答案]\` 来输出最终答案。


现在，请开始解决以下问题：
Question: {question}
History: {history}
`;

class ReActAgent {
  private llmClient: HelloAgentsLLM;
  private toolExecutor: ToolExecutor;
  private maxSteps: number;
  private history: string[];

  constructor(
    llmClient: HelloAgentsLLM,
    toolExecutor: ToolExecutor,
    maxSteps = 5
  ) {
    this.llmClient = llmClient;
    this.toolExecutor = toolExecutor;
    this.maxSteps = maxSteps;
    this.history = [];
  }

  async run(question: string): Promise<string | null> {
    this.history = [];

    for (let step = 1; step <= this.maxSteps; step++) {
      console.log(`\n--- 第 ${step} 步 ---`);

      const toolsDesc = this.toolExecutor.getAvailableTools();
      const historyStr = this.history.join("\n");
      const prompt = REACT_PROMPT_TEMPLATE.replace("{tools}", toolsDesc)
        .replace("{question}", question)
        .replace("{history}", historyStr);

      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "user", content: prompt },
      ];
      const responseText = await this.llmClient.think(messages);
      if (!responseText) {
        console.log("错误：LLM未能返回有效响应。");
        break;
      }

      const { thought, action } = this.parseOutput(responseText);
      if (thought) console.log(`🤔 思考: ${thought}`);
      if (!action) {
        console.log("警告：未能解析出有效的Action，流程终止。");
        break;
      }

      if (action.startsWith("Finish")) {
        const finalAnswer = this.parseActionInput(action);
        console.log(`🎉 最终答案: ${finalAnswer}`);
        return finalAnswer;
      }

      const { toolName, toolInput } = this.parseAction(action);
      if (!toolName || !toolInput) {
        this.history.push("Observation: 无效的Action格式，请检查。");
        continue;
      }

      console.log(`🎬 行动: ${toolName}[${toolInput}]`);
      const toolFunction = this.toolExecutor.getTool(toolName);
      const observation = toolFunction
        ? await toolFunction(toolInput)
        : `错误：未找到名为 '${toolName}' 的工具。`;

      console.log(`👀 观察: ${observation}`);
      this.history.push(`Action: ${action}`);
      this.history.push(`Observation: ${observation}`);
    }

    console.log("已达到最大步数，流程终止。");
    return null;
  }

  private parseOutput(text: string): {
    thought: string | null;
    action: string | null;
  } {
    const thoughtMatch = text.match(
      /Thought:\s*(.*?)(?=\nAction:|$)/s
    );
    const actionMatch = text.match(/Action:\s*(.*?)$/s);
    return {
      thought: thoughtMatch?.[1]?.trim() ?? null,
      action: actionMatch?.[1]?.trim() ?? null,
    };
  }

  private parseAction(actionText: string): {
    toolName: string | null;
    toolInput: string | null;
  } {
    const match = actionText.match(/(\w+)\[(.*)\]/s);
    return match
      ? { toolName: match[1], toolInput: match[2] }
      : { toolName: null, toolInput: null };
  }

  private parseActionInput(actionText: string): string {
    const match = actionText.match(/\w+\[(.*)\]/s);
    return match?.[1] ?? "";
  }
}

// ==================== 主程序 ====================

async function main() {
  const llm = new HelloAgentsLLM();
  const toolExecutor = new ToolExecutor();

  const searchDesc =
    "一个网页搜索引擎。当你需要回答关于时事、事实以及在你的知识库中找不到的信息时，应使用此工具。";
  toolExecutor.registerTool("Search", searchDesc, search);

  const question = "华为最新的手机是哪一款？它的主要卖点是什么？";
  await new ReActAgent(llm, toolExecutor).run(question);
}

main();
