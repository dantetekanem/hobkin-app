/** react-markdown's address rule, widened by one scheme: a `slack://` link, which the window hands to the system to open in the Slack app. */
export const keepSlackLinks =
  (transform: (url: string) => string | null | undefined) =>
  (url: string): string | null | undefined =>
    /^slack:\/\//i.test(url) ? url : transform(url)
