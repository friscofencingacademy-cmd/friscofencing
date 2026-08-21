import axios from 'axios';

// Services contract (CKQ's, adapted): QUERY functions call api.get and let
// errors throw — callers pair them with useLoadState, which expects a
// rejecting promise on failure. MUTATION functions (create/update/delete/...)
// never throw; they always resolve to a MutationResult so a page can render
// an inline dialog/form error without a try/catch at the call site.
export type MutationResult<T = undefined> =
  | { status: 'success'; data: T }
  | { status: 'error'; message: string };

export function extractErrorMessage(err: unknown, genericMessage: string): string {
  if (axios.isAxiosError(err) && typeof err.response?.data?.message === 'string') {
    return err.response.data.message;
  }
  return genericMessage;
}
