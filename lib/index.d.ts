import { ContextFormed } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/config.d.ts
/** 用户可通过 profile 配置提供的值; 缺省时由 schema 默认值补齐. */
interface Config {
  /** `/commit` 注入的规范文本. */
  commitPrompt: string;
  /** `/commit-fast` 注入的规范文本. */
  commitFastPrompt: string;
  /** `/tag` 注入的规范文本. */
  tagPrompt: string;
  /** `/push` 注入的规范文本. */
  pushPrompt: string;
  /** `/repo-create` 注入的规范文本. */
  repoCreatePrompt: string;
  /** 采集最近多少条 commit message. */
  logLimit: number;
  /** staged diff 最多保留多少行. */
  diffLineLimit: number;
}
/** Cordis Loader 读取并校验的插件 Config schema. */
declare const Config: z<Config>;
//#endregion
//#region src/message-source.d.ts
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'git-commands': {
      kind: 'git-commands';
    } & ContextFormed;
  }
}
//#endregion
//#region src/index.d.ts
/** 插件模块名. */
declare const name = "dsh-git-commands";
/** 依赖的命令注册表. */
declare const inject: string[];
/**
 * 注册全部 git 命令.
 *
 * @param ctx - Host 上下文.
 * @param config - Loader 按 Config schema 校验后的配置.
 */
declare function apply(ctx: Context, config: Config): void;
//#endregion
export { Config, apply, inject, name };
//# sourceMappingURL=index.d.ts.map