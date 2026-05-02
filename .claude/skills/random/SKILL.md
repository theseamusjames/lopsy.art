---
name: random
description: Randomly pick one item from a comma-separated list. Trigger whenever the user's message starts with "/random" followed by comma-separated options (e.g. "/random a,b,c,d,e"). This skill should always be used for these commands — do not attempt to pick randomly yourself.
---

# random

When the user sends a message matching `/random item1,item2,...`, run a Node.js one-liner via `bash_tool` that:

1. Parses the comma-separated list from the user's input.
2. Uses `Math.random()` to select one item uniformly at random.
3. Prints only the chosen item.

## Command Template

```bash
node -e "const items = 'ITEMS_HERE'.split(',').map(s=>s.trim()).filter(Boolean); console.log(items[Math.floor(Math.random()*items.length)])"
```

Replace `ITEMS_HERE` with the raw comma-separated string from the user.

## Response

Reply with **only** the chosen value — no explanation, no formatting, just the item. Bold it for visibility.