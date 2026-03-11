import OpenAI from "openai";
import { HelloAgentsLLM } from "./llm_client.js";

// ==================== 记忆模块 ====================

interface MemoryRecord {
  type: "execution" | "reflection";
  content: string;
}

class Memory {
  private records: MemoryRecord[] = [];

  addRecord(recordType: MemoryRecord["type"], content: string): void {
    this.records.push({ type: recordType, content });
    console.log(`📝 记忆已更新，新增一条 '${recordType}' 记录。`);
  }

  getTrajectory(): string {
    return this.records
      .map((record) => {
        if (record.type === "execution") {
          return `--- 上一轮尝试 (代码) ---\n${record.content}`;
        }
        return `--- 评审员反馈 ---\n${record.content}`;
      })
      .join("\n\n");
  }

  getLastExecution(): string | null {
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i].type === "execution") {
        return this.records[i].content;
      }
    }
    return null;
  }
}

// ==================== 提示词模板 ====================

const INITIAL_PROMPT_TEMPLATE = `
你是一位资深的JavaScript/TypeScript程序员。请根据以下要求，编写一个TypeScript函数。
你的代码必须包含完整的函数签名、JSDoc文档注释，并遵循最佳编码规范。

要求: {task}

请直接输出代码，不要包含任何额外的解释。
`;

const REFLECT_PROMPT_TEMPLATE = `
你是一位极其严格的代码评审专家和资深算法工程师，对代码的性能有极致的要求。
你的任务是审查以下TypeScript代码，并专注于找出其在**算法效率**上的主要瓶颈。

# 原始任务:
{task}

# 待审查的代码:
\`\`\`typescript
{code}
\`\`\`

请分析该代码的时间复杂度，并思考是否存在一种**算法上更优**的解决方案来显著提升性能。
如果存在，请清晰地指出当前算法的不足，并提出具体的、可行的改进算法建议（例如，使用筛法替代试除法）。
如果代码在算法层面已经达到最优，才能回答"无需改进"。

请直接输出你的反馈，不要包含任何额外的解释。
`;

const REFINE_PROMPT_TEMPLATE = `
你是一位资深的JavaScript/TypeScript程序员。你正在根据一位代码评审专家的反馈来优化你的代码。

# 原始任务:
{task}

# 你上一轮尝试的代码:
{last_code_attempt}

# 评审员的反馈:
{feedback}

请根据评审员的反馈，生成一个优化后的新版本代码。
你的代码必须包含完整的函数签名、JSDoc文档注释，并遵循最佳编码规范。
请直接输出优化后的代码，不要包含任何额外的解释。
`;

// ==================== Reflection 智能体 ====================

class ReflectionAgent {
  private llmClient: HelloAgentsLLM;
  private memory: Memory;
  private maxIterations: number;

  constructor(llmClient: HelloAgentsLLM, maxIterations = 3) {
    this.llmClient = llmClient;
    this.memory = new Memory();
    this.maxIterations = maxIterations;
  }

  async run(task: string): Promise<string | null> {
    console.log(`\n--- 开始处理任务 ---\n任务: ${task}`);

    // --- 1. 初始执行 ---
    console.log("\n--- 正在进行初始尝试 ---");
    const initialPrompt = INITIAL_PROMPT_TEMPLATE.replace("{task}", task);
    const initialCode = await this.getLlmResponse(initialPrompt);
    this.memory.addRecord("execution", initialCode);

    // --- 2. 迭代循环：反思与优化 ---
    for (let i = 0; i < this.maxIterations; i++) {
      console.log(`\n--- 第 ${i + 1}/${this.maxIterations} 轮迭代 ---`);

      // a. 反思
      console.log("\n-> 正在进行反思...");
      const lastCode = this.memory.getLastExecution()!;
      const reflectPrompt = REFLECT_PROMPT_TEMPLATE
        .replace("{task}", task)
        .replace("{code}", lastCode);
      const feedback = await this.getLlmResponse(reflectPrompt);
      this.memory.addRecord("reflection", feedback);

      // b. 检查是否需要停止
      if (
        feedback.includes("无需改进") ||
        feedback.toLowerCase().includes("no need for improvement")
      ) {
        console.log("\n✅ 反思认为代码已无需改进，任务完成。");
        break;
      }

      // c. 优化
      console.log("\n-> 正在进行优化...");
      const refinePrompt = REFINE_PROMPT_TEMPLATE
        .replace("{task}", task)
        .replace("{last_code_attempt}", lastCode)
        .replace("{feedback}", feedback);
      const refinedCode = await this.getLlmResponse(refinePrompt);
      this.memory.addRecord("execution", refinedCode);
    }

    const finalCode = this.memory.getLastExecution();
    console.log(`\n--- 任务完成 ---\n最终生成的代码:\n${finalCode}`);
    return finalCode;
  }

  private async getLlmResponse(prompt: string): Promise<string> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "user", content: prompt },
    ];
    return (await this.llmClient.think(messages)) ?? "";
  }
}

// ==================== 主程序 ====================

async function main() {
  try {
    const llmClient = new HelloAgentsLLM();
    const agent = new ReflectionAgent(llmClient, 2);
    const task =
      "编写一个TypeScript函数，找出1到n之间所有的素数 (prime numbers)。";
    await agent.run(task);
  } catch (e) {
    console.log(`初始化LLM客户端时出错: ${e}`);
  }
}

main();
