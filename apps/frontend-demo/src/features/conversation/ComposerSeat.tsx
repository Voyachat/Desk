import type { AppState, ClientCommand, SessionSummary } from '../../domain/client-state.ts'
import { ApprovalComposer } from '../approval/ApprovalComposer.tsx'
import { ComposerBar } from './ComposerBar.tsx'
import css from './ComposerSeat.module.css'

/** DSH conversation.composer chain: approval replaces the default bar in the same sticky seat. */
export function ComposerSeat({ state, session, dispatch }: { state: AppState; session: SessionSummary; dispatch(command: ClientCommand): void }) {
  const approval = state.pendingApproval?.sessionId === session.id ? state.pendingApproval : null
  return (
    <div className={css.seat} data-composer-seat>
      {approval === null ? (
        <ComposerBar state={state} variant="composer" dispatch={dispatch} />
      ) : (
        <ApprovalComposer approval={approval} onAnswer={(outcome) => { dispatch({ type: 'approval.answer', outcome }) }} />
      )}
    </div>
  )
}
