import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { DeleteAccountModal, deleteAccountScheduleFailureMessage } from './Me'

describe('DeleteAccountModal Team safeguards', () => {
  it('explains Team asset retention and the active Owner prerequisite', () => {
    const html = renderToStaticMarkup(
      <DeleteAccountModal
        open
        pendingUntil={null}
        onClose={() => undefined}
        onScheduled={() => undefined}
        onCancelled={() => undefined}
      />,
    )

    expect(html).toContain('Team-owned Sessions remain with their Team')
    expect(html).toContain('transfer ownership or archive the Team before continuing')
  })

  it('surfaces the backend conflict detail instead of a generic failure', () => {
    expect(
      deleteAccountScheduleFailureMessage({
        kind: 'conflict',
        detail: 'transfer or archive every Team you own before deleting your account',
      }),
    ).toBe(
      'Account deletion is blocked: transfer or archive every Team you own before deleting your account',
    )
  })

  it('keeps a specific Team prerequisite when a conflict has no detail', () => {
    expect(deleteAccountScheduleFailureMessage({ kind: 'conflict' })).toContain(
      'transfer ownership of or archive every Team you own first',
    )
  })
})
