const AGENT_SYSTEM_PROMPT = `
你是一个智能旅行助手。你的任务是分析用户的请求，并使用可用工具一步步地解决问题。

# 可用工具:
- \`get_weather(city: str)\`: 查询指定城市的实时天气。
- \`get_attraction(city: str, weather: str)\`: 根据城市和天气搜索推荐的旅游景点。

# 输出格式要求:
你的每次回复必须严格遵循以下格式，包含一对Thought和Action：

Thought: [你的思考过程和下一步计划]
Action: [你要执行的具体行动]

Action的格式必须是以下之一：
1. 调用工具：function_name(arg_name="arg_value")
2. 结束任务：Finish[最终答案]

# 重要提示:
- 每次只输出一对Thought-Action
- Action必须在同一行，不要换行
- 当收集到足够信息可以回答用户问题时，必须使用 Action: Finish[最终答案] 格式结束

请开始吧！
`;

import OpenAI from "openai";
import axios from "axios";

// ==================== 工具定义 ====================

async function get_weather(city: string): Promise<string> {
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;

  try {
    const { data } = await axios.get(url);

    const currentCondition = data.current_condition[0];
    const weatherDesc = currentCondition.weatherDesc[0].value;
    const tempC = currentCondition.temp_C;

    return `${city}当前天气：${weatherDesc}，气温${tempC}摄氏度`;
  } catch (e: any) {
    if (e.response) {
      return `错误：查询天气失败，HTTP ${e.response.status}`;
    }
    return `错误：查询天气时遇到网络问题 - ${e.message}`;
  }
}

async function get_attraction(city: string, weather: string): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return "错误：未配置TAVILY_API_KEY。";
  }

  const query = `'${city}' 在'${weather}'天气下最值得去的旅游景点推荐及理由`;

  try {
    const { data } = await axios.post("https://api.tavily.com/search", {
      api_key: apiKey,
      query,
      search_depth: "basic",
      include_answer: true,
    });

    if (data.answer) {
      return data.answer;
    }

    const results: { title: string; content: string }[] = data.results ?? [];
    if (results.length === 0) {
      return "抱歉，没有找到相关的旅游景点推荐。";
    }

    const formatted = results.map((r) => `- ${r.title}: ${r.content}`);
    return "根据搜索，为您找到以下信息：\n" + formatted.join("\n");
  } catch (e) {
    return `错误：执行Tavily搜索时出现问题 - ${e}`;
  }
}

const availableTools: Record<string, (...args: any[]) => Promise<string>> = {
  get_weather,
  get_attraction,
};

// ==================== LLM 客户端 ====================

class OpenAICompatibleClient {
  private model: string;
  private client: OpenAI;

  constructor(model: string, apiKey: string, baseURL: string) {
    this.model = model;
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async generate(prompt: string, systemPrompt: string): Promise<string> {
    console.log("正在调用大语言模型...");
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        stream: false,
      });
      const answer = response.choices[0].message.content ?? "";
      console.log("大语言模型响应成功。");
      return answer;
    } catch (e) {
      console.log(`调用LLM API时发生错误: ${e}`);
      return "错误：调用语言模型服务时出错。";
    }
  }
}

// ==================== 主程序 ====================

async function main() {
  // --- 1. 配置LLM客户端 ---
  // const API_KEY = "YOUR_API_KEY";
  // const BASE_URL = "YOUR_BASE_URL";
  // const MODEL_ID = "YOUR_MODEL_ID";
  const API_KEY = "sk-e9bef397609a4896b8ecca355c35cc12"
  const BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
  const MODEL_ID = "qwen-plus"
  process.env.TAVILY_API_KEY = "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";

  const llm = new OpenAICompatibleClient(MODEL_ID, API_KEY, BASE_URL);

  // --- 2. 初始化 ---
  const userPrompt =
    "你好，请帮我查询一下今天北京的天气，然后根据天气推荐一个合适的旅游景点。";
  const promptHistory: string[] = [`用户请求: ${userPrompt}`];

  console.log(`用户输入: ${userPrompt}\n${"=".repeat(40)}`);

  // --- 3. 运行主循环 ---
  for (let i = 0; i < 5; i++) {
    console.log(`--- 循环 ${i + 1} ---\n`);

    // 3.1. 构建Prompt
    const fullPrompt = promptHistory.join("\n");

    // 3.2. 调用LLM进行思考
    let llmOutput = await llm.generate(fullPrompt, AGENT_SYSTEM_PROMPT);

    const match = llmOutput.match(
      /(Thought:.*?Action:.*?)(?=\n\s*(?:Thought:|Action:|Observation:)|\s*$)/s
    );
    if (match) {
      const truncated = match[1].trim();
      if (truncated !== llmOutput.trim()) {
        llmOutput = truncated;
        console.log("已截断多余的 Thought-Action 对");
      }
    }

    console.log(`模型输出:\n${llmOutput}\n`);
    promptHistory.push(llmOutput);

    // 3.3. 解析并执行行动
    const actionMatch = llmOutput.match(/Action: (.*)/s);
    if (!actionMatch) {
      const observation =
        "错误: 未能解析到 Action 字段。请确保你的回复严格遵循 'Thought: ... Action: ...' 的格式。";
      const observationStr = `Observation: ${observation}`;
      console.log(`${observationStr}\n${"=".repeat(40)}`);
      promptHistory.push(observationStr);
      continue;
    }

    const actionStr = actionMatch[1].trim();

    if (actionStr.startsWith("Finish")) {
      const finishMatch = actionStr.match(/Finish\[(.*)\]/);
      if (finishMatch) {
        console.log(`任务完成，最终答案: ${finishMatch[1]}`);
      }
      break;
    }

    const toolNameMatch = actionStr.match(/(\w+)\(/);
    const argsStrMatch = actionStr.match(/\((.*)\)/);
    if (!toolNameMatch || !argsStrMatch) {
      const observation = "错误: 无法解析工具名称或参数。";
      const observationStr = `Observation: ${observation}`;
      console.log(`${observationStr}\n${"=".repeat(40)}`);
      promptHistory.push(observationStr);
      continue;
    }

    const toolName = toolNameMatch[1];
    const argsStr = argsStrMatch[1];
    const kwargs: Record<string, string> = {};
    const argPattern = /(\w+)="([^"]*)"/g;
    let argMatch: RegExpExecArray | null;
    while ((argMatch = argPattern.exec(argsStr)) !== null) {
      kwargs[argMatch[1]] = argMatch[2];
    }

    let observation: string;
    if (toolName in availableTools) {
      const toolFn = availableTools[toolName];
      if (toolName === "get_weather") {
        observation = await toolFn(kwargs.city);
      } else if (toolName === "get_attraction") {
        observation = await toolFn(kwargs.city, kwargs.weather);
      } else {
        observation = await toolFn(...Object.values(kwargs));
      }
    } else {
      observation = `错误：未定义的工具 '${toolName}'`;
    }

    // 3.4. 记录观察结果
    const observationStr = `Observation: ${observation}`;
    console.log(`${observationStr}\n${"=".repeat(40)}`);
    promptHistory.push(observationStr);
  }
}

main();
