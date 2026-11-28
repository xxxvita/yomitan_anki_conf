// scoring-provider.ts — maps a shadow answer-checking engine to the server-side
// scoring provider (Ф3a, task #1068).
//
// engines.check is a UI literal ('llm-local'|'turmalin'|'gpt'|'rules'); the
// finalize-attempt handler keys its LLM-scoring branch on the provider name.
// Only 'ollama' is wired in Ф3a (local LLM); 'turmalin' is Ф3b; 'programmatic'
// means "do not call an LLM — use the deterministic diff".

export function scoringProviderForCheck(check: string): string {
  switch (check) {
    case 'llm-local':
      return 'ollama';
    case 'turmalin':
      return 'turmalin';
    case 'gpt':
      return 'gpt';
    default:
      return 'programmatic'; // 'rules' and any unknown value → no LLM
  }
}
