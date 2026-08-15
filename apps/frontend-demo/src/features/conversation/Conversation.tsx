import type { AppState, ClientCommand, SessionSummary } from '../../domain/client-state.ts'
import { ConversationHeader } from './ConversationHeader.tsx'
import { Transcript } from './Transcript.tsx'
import { NewSessionHero } from './NewSessionHero.tsx'
import { ComposerSeat } from './ComposerSeat.tsx'
import { TrajectoryView } from '../trajectory/TrajectoryView.tsx'
import css from './Conversation.module.css'

export interface ConversationProps {
  state: AppState
  session: SessionSummary | undefined
  dispatch(command: ClientCommand): void
}

/** Resident conversation slot. Header/view/composer keep stable seats across state changes. */
export function Conversation({ state, session, dispatch }: ConversationProps) {
  const isHero = session === undefined
  return (
    <div className={css.root} data-phase={isHero ? 'hero' : 'active'}>
      {session !== undefined && (
        <ConversationHeader
          session={session}
          view={state.view}
          onSelectView={(view) => { dispatch({ type: 'view.select', view }) }}
        />
      )}
      <div className={css.scrollBody} data-conversation-scroll>
        {isHero ? (
          <NewSessionHero state={state} dispatch={dispatch} />
        ) : state.view === 'chat' ? (
          <Transcript session={session} onOpenDetails={(details) => { dispatch({ type: 'details.open', details }) }} />
        ) : (
          <TrajectoryView session={session} onOpenDetails={(details) => { dispatch({ type: 'details.open', details }) }} />
        )}
        {!isHero && <ComposerSeat state={state} session={session} dispatch={dispatch} />}
      </div>
    </div>
  )
}
