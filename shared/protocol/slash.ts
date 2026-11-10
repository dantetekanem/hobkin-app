/** A command the message input runs when the message starts with a slash. */
export interface SlashCommand {
  /** With its slash, as it is typed: `/help`. */
  name: string
  /** One line on what it does. */
  description: string
  /** `hobkin`: one of hobkin's own. `pi`: an extension command, prompt template or skill Pi offers for the session. */
  source: 'hobkin' | 'pi'
  /** How often the user has run it. */
  count: number
}

/** What running a command gives back to show. */
export interface SlashOutcome {
  /** One line to say, as the terminal app says it under the input. */
  said?: string
  /** Text to show in the conversation for the user only, such as the help. hobkin's agent never sees it. */
  shown?: string
}
