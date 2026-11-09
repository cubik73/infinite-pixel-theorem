export type Status = 'idle' | 'working'

declare module 'claude-code' {
  interface PluginState {
    'prompt-master': { status: Status; original: string | null }
  }
}
