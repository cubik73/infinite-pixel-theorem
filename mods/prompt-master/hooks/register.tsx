import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Status } from '../types'

const status = atom({ plugin: 'prompt-master', key: 'status' } as const, 'idle' as Status)
const original = atom({ plugin: 'prompt-master', key: 'original' } as const, null as string | null)

const SYSTEM = `You are Prompt Master, an expert prompt engineer. The user gives you a rough draft of a message they are about to send to an AI coding assistant. Rewrite it into a better prompt.

Rules:
- Keep the user's intent, facts, names, file paths, code and constraints exactly; never invent requirements or details they did not imply.
- Make the goal explicit up front, then add the context, constraints and what "done" looks like, when the draft implies them.
- Fix spelling and grammar, remove ambiguity and filler, and structure longer asks as short bullet points.
- Keep it concise: a one-line ask stays short. Write in the user's voice (first person, addressed to the assistant).
- Keep the draft's language.
- Output ONLY the rewritten prompt: no preamble, no quotes, no explanation.`

type Outcome = { ok: true; text: string } | { ok: false; message: string }

async function rewrite($: EngineInterface, draft: string): Promise<Outcome> {
  const result = await $.model.complete({
    model: 'sonnet',
    system: SYSTEM,
    prompt: `Rough draft:\n<draft>\n${draft}\n</draft>\n\nRewrite it now.`,
    maxTokens: 2048,
  })
  if (!result.isAnswered) {
    return { ok: false, message: `Prompt Master could not rewrite it (${result.reason}).` }
  }
  const text = result.text.trim()
  return text ? { ok: true, text } : { ok: false, message: 'Prompt Master got an empty reply.' }
}

async function improveDraft($: EngineInterface, given?: string): Promise<string> {
  if ((await read($, status)) === 'working') return 'Prompt Master is already working.'
  const draft = (given ?? (await $.prompt.read()).text).trim()
  if (!draft) {
    $.ui.toast('Type a rough prompt first, then press Prompt Master.')
    return 'Nothing to rewrite: the prompt box is empty.'
  }

  await update($, status, () => 'working')
  try {
    const outcome = await rewrite($, draft)
    if (!outcome.ok) {
      $.ui.toast(outcome.message)
      return outcome.message
    }
    const filled = await $.prompt.fill({ text: outcome.text, mode: 'replace' })
    await update($, original, () => draft)
    if (!filled.isFilled) return `Improved prompt:\n\n${outcome.text}`
    $.ui.toast('Prompt improved. Review it, then press Enter to send.')
    return 'Prompt rewritten in the prompt box.'
  } finally {
    await update($, status, () => 'idle')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prompt-master',
      description: 'Rewrite the draft in the prompt box (or the text after the command) into a better prompt',
    })
    return next(e)
  })

  on('command.run', { command: 'prompt-master' }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'undo') {
      const before = await read($, original)
      if (before === null) return { text: 'Nothing to undo.' }
      await $.prompt.fill({ text: before, mode: 'replace' })
      await update($, original, () => null)
      return { text: 'Restored your original draft.' }
    }
    return { text: await improveDraft($, args || undefined) }
  })

  // Once the prompt is sent, the saved original no longer matters.
  on('prompt.submit', async ($, e, next) => {
    await update($, original, () => null).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isWorking = (await read($, status)) === 'working'
    const before = await read($, original)

    return (
      <Box flexDirection="row" gap={1}>
        {isWorking ? (
          <Text dimColor>✨ Prompt Master is rewriting your prompt…</Text>
        ) : (
          <Button key="improve" label="✨ Prompt Master" onPress={() => improveDraft($)} />
        )}
        {!isWorking && before !== null ? (
          <Button
            key="undo"
            label="Undo"
            onPress={async () => {
              await $.prompt.fill({ text: before, mode: 'replace' })
              await update($, original, () => null)
            }}
          />
        ) : null}
      </Box>
    )
  })
}
