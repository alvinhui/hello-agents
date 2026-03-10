import OpenAI from "openai";
import { HelloAgentsLLM } from "./llm_client";

// ==================== 规划器 (Planner) ====================

const PLANNER_PROMPT_TEMPLATE = `
你是一个顶级的AI规划专家。你的任务是将用户提出的复杂问题分解成一个由多个简单步骤组成的行动计划。
请确保计划中的每个步骤都是一个独立的、可执行的子任务，并且严格按照逻辑顺序排列。
你的输出必须是一个javascript列表，其中每个元素都是一个描述子任务的字符串。

问题: {question}

请严格按照以下格式输出你的计划，\`\`\`javascript与\`\`\`作为前后缀是必要的:
\`\`\`javascript
["步骤1", "步骤2", "步骤3", ...]
\`\`\`
`;

class Planner {
  private llmClient: HelloAgentsLLM;

  constructor(llmClient: HelloAgentsLLM) {
    this.llmClient = llmClient;
  }

  async plan(question: string): Promise<string[]> {
    const prompt = PLANNER_PROMPT_TEMPLATE.replace("{question}", question);
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "user", content: prompt },
    ];

    console.log("--- 正在生成计划 ---");
    const responseText = (await this.llmClient.think(messages)) ?? "";
    console.log(`✅ 计划已生成:\n${responseText}`);

    try {
      const codeBlock = responseText.split("```javascript")[1]?.split("```")[0]?.trim();
      if (!codeBlock) {
        throw new Error("未找到 ```javascript 代码块");
      }
      const plan: unknown = JSON.parse(codeBlock);
      return Array.isArray(plan) ? (plan as string[]) : [];
    } catch (e) {
      console.log(`❌ 解析计划时出错: ${e}`);
      console.log(`原始响应: ${responseText}`);
      return [];
    }
  }
}

// ==================== 执行器 (Executor) ====================

const EXECUTOR_PROMPT_TEMPLATE = `
你是一位顶级的AI执行专家。你的任务是严格按照给定的计划，一步步地解决问题。
你将收到原始问题、完整的计划、以及到目前为止已经完成的步骤和结果。
请你专注于解决"当前步骤"，并仅输出该步骤的最终答案，不要输出任何额外的解释或对话。

# 原始问题:
{question}

# 完整计划:
{plan}

# 历史步骤与结果:
{history}

# 当前步骤:
{current_step}

请仅输出针对"当前步骤"的回答:
`;

class Executor {
  private llmClient: HelloAgentsLLM;

  constructor(llmClient: HelloAgentsLLM) {
    this.llmClient = llmClient;
  }

  async execute(question: string, plan: string[]): Promise<string> {
    let history = "";
    let finalAnswer = "";

    console.log("\n--- 正在执行计划 ---");
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      const stepNum = i + 1;
      console.log(`\n-> 正在执行步骤 ${stepNum}/${plan.length}: ${step}`);

      const prompt = EXECUTOR_PROMPT_TEMPLATE
        .replace("{question}", question)
        .replace("{plan}", JSON.stringify(plan))
        .replace("{history}", history || "无")
        .replace("{current_step}", step);

      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "user", content: prompt },
      ];

      const responseText = (await this.llmClient.think(messages)) ?? "";

      history += `步骤 ${stepNum}: ${step}\n结果: ${responseText}\n\n`;
      finalAnswer = responseText;
      console.log(`✅ 步骤 ${stepNum} 已完成，结果: ${finalAnswer}`);
    }

    return finalAnswer;
  }
}

// ==================== Plan-and-Solve Agent ====================

class PlanAndSolveAgent {
  private planner: Planner;
  private executor: Executor;

  constructor(llmClient: HelloAgentsLLM) {
    this.planner = new Planner(llmClient);
    this.executor = new Executor(llmClient);
  }

  async run(question: string): Promise<void> {
    console.log(`\n--- 开始处理问题 ---\n问题: ${question}`);

    const plan = await this.planner.plan(question);
    if (plan.length === 0) {
      console.log("\n--- 任务终止 --- \n无法生成有效的行动计划。");
      return;
    }

    const finalAnswer = await this.executor.execute(question, plan);
    console.log(`\n--- 任务完成 ---\n最终答案: ${finalAnswer}`);
  }
}

// ==================== 主程序 ====================

async function main() {
  const llmClient = new HelloAgentsLLM();
  const agent = new PlanAndSolveAgent(llmClient);
  const question =
    "一个水果店周一卖出了15个苹果。周二卖出的苹果数量是周一的两倍。周三卖出的数量比周二少了5个。请问这三天总共卖出了多少个苹果？";
  await agent.run(question);
}

main();
