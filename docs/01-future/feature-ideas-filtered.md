| 1 | Search in a discussion (Ctrl+F)            | M | — | — | Long discussions have no way to find a message. Search
all branches, jump to the result |
| 3 | Several discussions in one window | L | — | — | In `todo.md`. A list of discussions on the left, one window
instead of many |
| 8 | Reactions (👍, ❤, …)                 | M | yes | yes | A small event per reaction; last writer wins per person and
emoji |
| 11 | Day separators and "jump to date"    | S | — | — | Display only |
| 12 | Drafts kept after a restart | S | — | — | Local state per discussion and branch; today a draft is lost when the
app closes |
| 14 | File attachments (PDF, DOCX, ZIP, …) | L | yes | — | The image part transport can carry them. Needs a size limit,
an "open with" warning, and no automatic opening |
| 15 | Branch map (a tree view of all branches) | M | — | — | Shows depth, state, and unread counts; click opens a
branch |
| 21 | Same person on two computers | XL | yes | yes | Today one key pair per Windows user. Needs device keys under one
person and their own key changes |
| 23 | English user interface | M | — | — | All texts are in `ru.ts` already; add a second file and a language setting |
| 24 | Text size setting (zoom)             | S | — | — | Ctrl+plus and Ctrl+minus, kept in the settings |
| 25 | List of keyboard shortcuts (F1)      | S | — | — | A dialog with the shortcuts that exist |
| 30 | Diagnostics: "Сохранить отчёт…"                 | S | — | — | A ZIP of logs and sync state (no keys, no message
text) that a person can send for support |

another thing I'm thinking of is - probably using zip file for a chat is not the best from performance, storage and
other points of view.
probably a local DB is a better solution, right?
I'd like to see options here and pros/cons for those.
ultimately I still want to have an option to export/import .branchchat file and use it to share, but local storage
probably should be optimized.
