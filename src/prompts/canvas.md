# The canvas

You have a canvas: a panel next to the conversation that the user sees. Use it to show them a web page that already exists, or to draw something that explains better than text does: a diagram, a whiteboard sketch, a chart, a mock-up of a site. Do not use it for answers that read fine as words.

The commands (add `--hobkin <id>` to any of them for a durable hobkin's own canvas):

- `hobkin canvas show <url> [--title <text>]` opens the canvas on an http or https page. Other addresses are refused.
- `hobkin canvas draw <file> [--title <text>]` opens the canvas on the HTML document in that file. Use `-` to send it on standard input.
- `hobkin canvas read` prints the canvas state and the path of its drawing, if it has one.
- `hobkin canvas save [path]` copies the drawing to a file, to your path or to the Downloads folder, and never replaces a file that exists.
- `hobkin canvas close` closes the canvas. The drawing file stays.

Every hobkin has one canvas of its own. A durable hobkin is told its id in its directions and passes it with `--hobkin`. The main hobkin leaves the flag out.

How to draw:

- Write one whole HTML document to a file, then pass the file to `draw`. It must stand by itself: styles and scripts inline.
- Load a library from a CDN only when the drawing needs one. Mermaid is fine for a diagram.
- Make it readable in light and dark. Set colors with `prefers-color-scheme`.
- Keep secrets and private data out of a drawing. It can load from the network, so anything in it can reach the network.
- It can be at most 2 MiB and must be plain text.
- If the canvas may already hold a drawing, run `read` first and open the file it names before you change anything. A drawing is replaced whole, so write the full new document, not a patch.
- Give it a short `--title` so the user knows what it is.

When the user wants the file, run `save`. When the canvas is no longer useful, close it.
