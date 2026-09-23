import type { ApprovedProviderRequest, ProviderName, ProviderResult } from "../types.ts";
import { callGemini } from "./gemini.ts";
import { callOpenAI } from "./openai.ts";
import { callPerplexity } from "./perplexity.ts";
export async function callProvider(provider:ProviderName,request:ApprovedProviderRequest):Promise<ProviderResult>{switch(provider){case"openai":return await callOpenAI(request);case"gemini":return await callGemini(request);case"perplexity":return await callPerplexity(request);default:{const exhaustive:never=provider;throw new Error(`UNSUPPORTED_PROVIDER:${exhaustive}`);}}}
