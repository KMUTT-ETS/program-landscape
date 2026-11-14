# Canva recipe

## Start

1. `resolve-shortlink` with the ID after `canva.link/` → design URL; the design ID is the path segment after `/design/`.
2. `read-design` with `filter.fields: ["design_metadata","page_metadata","design_content","thumbnails"]` — check page size (1920×1080) and what is already there.
3. `read-design` with `open_transaction: true` → `transaction_id`.
4. Add the pages you need: one `edit-design` call on page 1 with several `{"type":"add_page","width":1920,"height":1080,"background_color":"#FFFFFF","title":"<slide name>"}` ops. Then `read-design` with `design_content` for the new page indices to get their `id`s.

## One slide = two calls, then save

**Call 1 — shapes and text** (page `PBxxxx`, `page_index` from the latest `page_metadata`):

```json
[
  {"type":"insert_shape","page_id":"PBxxxx","top":0,"left":0,"width":24,"height":1080,
   "path":"M0 0 H100 V100 H0 Z","view_box_width":100,"view_box_height":100,"color":"#0F766E"},
  {"type":"add_text","page_id":"PBxxxx","text":"02 · WHERE IT RUNS","top":90,"left":120,"width":1600},
  {"type":"add_text","page_id":"PBxxxx","text":"Pipeline ทำงานเป็น job ใน ingestion worker","top":135,"left":120,"width":1700},
  {"type":"insert_shape","page_id":"PBxxxx","top":320,"left":120,"width":520,"height":560,
   "path":"M0 0 H100 V100 H0 Z","view_box_width":100,"view_box_height":100,"color":"#F1F5F9","corner_rounding":24},
  {"type":"add_text","page_id":"PBxxxx","text":"INPUTS","top":360,"left":160,"width":440},
  {"type":"add_text","page_id":"PBxxxx","text":"เล่มหลักสูตร PDF (มคอ.2)\nAI provider key 1 ตัว","top":430,"left":160,"width":440}
]
```

Text boxes are created at 16 px, black. Shapes must come before the text that sits on them (later elements draw on top).

**Call 2 — style**, using the `locator_id`s from call 1's returned `document`:

```json
[
  {"type":"format_text","locator_id":"PBxxxx-LBkicker","formatting":{"font_size":26,"font_weight":"bold","color":"#0F766E"}},
  {"type":"format_text","locator_id":"PBxxxx-LBtitle","formatting":{"font_size":64,"font_weight":"bold","color":"#0F172A"}},
  {"type":"format_text","locator_id":"PBxxxx-LBhead","formatting":{"font_size":30,"font_weight":"bold","color":"#0F766E"}},
  {"type":"format_text","locator_id":"PBxxxx-LBbody","formatting":{"font_size":28,"color":"#1E293B","line_height":1.5,"list_level":1,"list_marker":"disc"}}
]
```

Check the returned thumbnail. Fix overflow or bad Thai line breaks (`resize_element`, `position_element`, or `replace_text` with a `\n`) in the same transaction.

**Save and reopen:**

1. `edit-design` `{"transaction_id":…,"finalize":"commit"}`
2. `read-design` `{"open_transaction":true,"filter":{"fields":["page_metadata"]}}` → new `transaction_id`, current page order.

## Translating or editing an existing deck

Use `replace_text` per locator (keeps formatting) or `find_and_replace_text` for one phrase. Set `font_style: "normal"` on any Thai text that was italic. Re-check the thumbnail: Thai is usually longer, so cards may need resizing.

## Moving a page

`{"type":"reorder_page","page_id":"<new>","anchor_page_id":"<title page>","position":"after"}` — run it from any page's `edit-design` call, then re-read `page_metadata`.
