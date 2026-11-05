import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { setTimeout as delay } from 'node:timers/promises';
export const inject = ['llm'];
class FixtureAdapter extends LlmAdapter {
  providerInfo(provider) { return { id: provider, name: 'Companion Test Model' }; }
  async listModels(provider) { return [{ provider, id:'fixture', name:'Fixture',inputModalities:['text','image'] }]; }
  async resolveModel(provider, model) { return {provider,id:model,name:'Fixture',inputModalities:['text','image'],context:{contextWindow:128000}}; }
  async *stream(options) {
    const text='这是 DSH 原生快捷助手的集成测试结果。';
    yield {type:'block-start',index:0,blockType:'text'};
    for(const part of [text.slice(0,12),text.slice(12)]) {
      await delay(80,undefined,{signal:options.signal});
      yield {type:'text-delta',index:0,text:part};
    }
    yield {type:'block-end',index:0,block:{type:'text',text}};
    yield {type:'finish',reason:{kind:'stop'}};
  }
}
export async function apply(ctx) {
  ctx.llm.registerAdapter(['companion-fixture'],new FixtureAdapter());
}
