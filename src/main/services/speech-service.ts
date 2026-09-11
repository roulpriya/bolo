import { normalizeLanguageCode, synthesize, translateText } from "./sarvam.ts";
import { cleanText } from "./service-errors.ts";

type MaybePromise<T> = Promise<T> | T;
export interface SarvamLike {
  synthesize: (
    text: string,
    options?: Record<string, unknown>
  ) => MaybePromise<Buffer>;
  translateText: (
    text: string,
    options?: Record<string, unknown>
  ) => MaybePromise<{ sourceLanguageCode?: string; text: string }>;
}

export class SpeechService {
  readonly provider: SarvamLike;

  constructor(provider: SarvamLike = { synthesize, translateText }) {
    this.provider = provider;
  }

  async localize(text: string, languageCode: string): Promise<string> {
    const target = normalizeLanguageCode(languageCode);
    if (target === "en-IN") {
      return text;
    }
    return (
      await this.provider.translateText(text, {
        sourceLanguageCode: "en-IN",
        targetLanguageCode: target,
      })
    ).text;
  }

  async translateAnswer(text: string, languageCode: string): Promise<string> {
    if (languageCode === "en-IN") {
      return text;
    }
    return (
      await this.provider.translateText(text, {
        sourceLanguageCode: languageCode,
        targetLanguageCode: "en-IN",
      })
    ).text;
  }

  async synthesize(text: string, languageCode = "en-IN"): Promise<Uint8Array> {
    return new Uint8Array(
      await this.provider.synthesize(
        cleanText(text, 600, "No response text supplied."),
        {
          targetLanguageCode: normalizeLanguageCode(languageCode),
        }
      )
    );
  }
}
