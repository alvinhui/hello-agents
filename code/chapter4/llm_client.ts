import OpenAI from "openai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export class HelloAgentsLLM {
  private model: string;
  private client: OpenAI;

  constructor(opts?: {
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    timeout?: number;
  }) {
    this.model = opts?.model ?? process.env.MODEL_ID ?? "";
    const apiKey = opts?.apiKey ?? process.env.API_KEY ?? "";
    const baseUrl = opts?.baseUrl ?? process.env.BASE_URL ?? "";
    const timeout = (opts?.timeout ?? 60) * 1000;

    if (!this.model || !apiKey || !baseUrl) {
      throw new Error(
        "模型ID、API密钥和服务地址必须被提供或在.env文件中定义。"
      );
    }

    this.client = new OpenAI({ apiKey, baseURL: baseUrl, timeout });
  }

  async think(
    messages: OpenAI.ChatCompletionMessageParam[],
    temperature = 0
  ): Promise<string | null> {
    console.log(`🧠 正在调用 ${this.model} 模型...`);
    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature,
        stream: true,
      });

      console.log("✅ 大语言模型响应成功:");
      const chunks: string[] = [];
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content ?? "";
        // process.stdout.write(content);
        chunks.push(content);
      }
      // console.log();
      return chunks.join("");
    } catch (e) {
      console.log(`❌ 调用LLM API时发生错误: ${e}`);
      return null;
    }
  }
}
