// Size policy (ADR-0005, ADR-0008) driven through the Stop hook seam: the width limit with its override
// and fallback, the per-reply output budget, and the notices both produce. MERMAID_FOR_CLAUDE_MAX_WIDTH
// is fixed explicitly wherever a snapshot is compared, so a runner with or without a terminal prints the
// same; the live width the terminal would give has its own file, test/terminal-width.test.mjs.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fence, fixture, runStopHook, snapshot } from './seams/stop-hook.mjs';

const OUTPUT_BUDGET_CHARS = 9_800;
const SUMMARY_RESERVE_CHARS = 140;
const SEPARATOR = '\n\n';
const BUDGET_REASON = 'output budget exhausted (9,800 chars per reply)';

const widestRow = (text) => Math.max(...text.split('\n').map((row) => [...row].length));
const renderedAt = (name, position) => snapshot(name).replace('diagram 1/1', `diagram ${position}`);

describe('width limit', () => {
  it('replaces a diagram wider than the limit with a notice naming its width and the limit', () => {
    const { output } = runStopHook(fence(fixture('size-sequence-wide')), { MERMAID_FOR_CLAUDE_MAX_WIDTH: '120' });
    assert.equal(output.systemMessage, 'mermaid-for-claude: could not render diagram 1/1 (sequenceDiagram): 208 columns wide, limit is 120');
  });

  it('renders the same diagram when MERMAID_FOR_CLAUDE_MAX_WIDTH=220', () => {
    const { output } = runStopHook(fence(fixture('size-sequence-wide')), { MERMAID_FOR_CLAUDE_MAX_WIDTH: '220' });
    assert.equal(output.systemMessage, snapshot('size-sequence-wide'));
    assert.equal(widestRow(output.systemMessage), 208);
  });

  it('names the override as the limit in the notice', () => {
    const { output } = runStopHook(fence(fixture('size-sequence-wide')), { MERMAID_FOR_CLAUDE_MAX_WIDTH: '200' });
    assert.equal(output.systemMessage, 'mermaid-for-claude: could not render diagram 1/1 (sequenceDiagram): 208 columns wide, limit is 200');
  });

  it('accepts an override padded with spaces', () => {
    const { output } = runStopHook(fence(fixture('size-sequence-wide')), { MERMAID_FOR_CLAUDE_MAX_WIDTH: ' 220 ' });
    assert.equal(output.systemMessage, snapshot('size-sequence-wide'));
  });

  it('falls back to 120 when the override is unset and no terminal answers', () => {
    assert.equal(process.stdout.isTTY, undefined, 'this test must run without a tty (node --test pipes stdout)');
    const { output } = runStopHook(fence(fixture('size-sequence-wide')), { MERMAID_FOR_CLAUDE_MAX_WIDTH: undefined });
    assert.equal(output.systemMessage, 'mermaid-for-claude: could not render diagram 1/1 (sequenceDiagram): 208 columns wide, limit is 120');
  });

  it('falls back to 120 when the override is junk', () => {
    for (const value of ['abc', '0', '-5', '', ' ', '1.5', '220px']) {
      const { output } = runStopHook(fence(fixture('size-sequence-wide')), { MERMAID_FOR_CLAUDE_MAX_WIDTH: value });
      assert.equal(
        output.systemMessage,
        'mermaid-for-claude: could not render diagram 1/1 (sequenceDiagram): 208 columns wide, limit is 120',
        `MAX_WIDTH=${JSON.stringify(value)} should fall back to 120`,
      );
    }
  });

  it('measures the widest row in code points and keeps astral-plane characters', () => {
    const fits = runStopHook(fence(fixture('size-astral')), { MERMAID_FOR_CLAUDE_MAX_WIDTH: '30' });
    assert.equal(fits.output.systemMessage, snapshot('size-astral'));
    assert.match(fits.output.systemMessage, /𝔘nicode 𝕏 start/);
    assert.match(fits.output.systemMessage, /end 𝒵/);
    assert.equal(widestRow(fits.output.systemMessage.split('\n').slice(1).join('\n')), 30);

    const tooWide = runStopHook(fence(fixture('size-astral')), { MERMAID_FOR_CLAUDE_MAX_WIDTH: '29' });
    assert.equal(tooWide.output.systemMessage, 'mermaid-for-claude: could not render diagram 1/1 (flowchart): 30 columns wide, limit is 29');
  });

  it('checks each block on its own: a wide block becomes a notice and the next one still renders', () => {
    const reply = `${fence(fixture('size-sequence-wide'))}\n${fence(fixture('size-small'))}`;
    const { output } = runStopHook(reply, { MERMAID_FOR_CLAUDE_MAX_WIDTH: '120' });
    assert.equal(
      output.systemMessage,
      'mermaid-for-claude: could not render diagram 1/2 (sequenceDiagram): 208 columns wide, limit is 120' + SEPARATOR + renderedAt('size-small', '2/2'),
    );
  });
});

describe('output budget', () => {
  it('skips the block that does not fit and still renders the next one', () => {
    const reply = `${fence(fixture('size-mid'))}\n${fence(fixture('size-big'))}\n${fence(fixture('size-small'))}`;
    const { output } = runStopHook(reply, { MERMAID_FOR_CLAUDE_MAX_WIDTH: '120' });
    const sections = output.systemMessage.split(SEPARATOR);
    assert.equal(sections.length, 3);
    assert.equal(sections[0], renderedAt('size-mid', '1/3'));
    assert.equal(sections[1], `mermaid-for-claude: could not render diagram 2/3 (flowchart): ${BUDGET_REASON}`);
    assert.equal(sections[2], renderedAt('size-small', '3/3'));
    assert.ok(output.systemMessage.length <= OUTPUT_BUDGET_CHARS);
  });

  it('shows a single block under the budget in full', () => {
    const { output } = runStopHook(fence(fixture('size-big')), { MERMAID_FOR_CLAUDE_MAX_WIDTH: '120' });
    assert.equal(output.systemMessage, snapshot('size-big'));
    assert.equal(output.systemMessage.length, 9_391);
    assert.ok(output.systemMessage.length < OUTPUT_BUDGET_CHARS);
    assert.doesNotMatch(output.systemMessage, /persisted-output|budget/);
  });

  it('never cuts a tall diagram: every row of a 93-row block is shown', () => {
    const { output } = runStopHook(fence(fixture('size-big')), { MERMAID_FOR_CLAUDE_MAX_WIDTH: '120' });
    const [header, ...body] = output.systemMessage.split('\n');
    assert.equal(header, 'mermaid-for-claude: diagram 1/1 (flowchart)');
    assert.equal(body.length, 93);
    assert.match(body.at(-1), /^└/);
    assert.match(output.systemMessage, /Nightly batch ends/);
  });

  it('keeps the payload under the budget for forty-seven blocks and closes with one notice and one skipped line', () => {
    const reply = Array.from({ length: 47 }, () => fence(fixture('size-small'))).join('\n');
    const { output } = runStopHook(reply, { MERMAID_FOR_CLAUDE_MAX_WIDTH: '120' });
    const payload = output.systemMessage;
    assert.ok(payload.length < OUTPUT_BUDGET_CHARS, `payload is ${payload.length} chars`);
    assert.equal(payload.length, 9_741);

    const sections = payload.split(SEPARATOR);
    const closing = sections.at(-1);
    assert.equal(closing, `mermaid-for-claude: diagrams 44/47 to 47/47 skipped: ${BUDGET_REASON}`);
    assert.equal(sections.at(-2), `mermaid-for-claude: could not render diagram 43/47 (stateDiagram): ${BUDGET_REASON}`);
    assert.deepEqual(
      sections.slice(0, -2),
      Array.from({ length: 42 }, (_, index) => renderedAt('size-small', `${index + 1}/47`)),
    );

    // Accounting (ADR-0008): headers, bodies and separators all count. Next to the 140-character reserve
    // a 43rd diagram does not fit but its notice does; a 44th notice would not, so the closing line follows.
    const usedBeforeNotice = sections.slice(0, -2).join(SEPARATOR).length;
    assert.ok(usedBeforeNotice + SEPARATOR.length + renderedAt('size-small', '43/47').length + SUMMARY_RESERVE_CHARS > OUTPUT_BUDGET_CHARS);
    assert.ok(usedBeforeNotice + SEPARATOR.length + sections.at(-2).length + SUMMARY_RESERVE_CHARS <= OUTPUT_BUDGET_CHARS);
    const usedBeforeClosing = sections.slice(0, -1).join(SEPARATOR).length;
    const nextNotice = `mermaid-for-claude: could not render diagram 44/47 (stateDiagram): ${BUDGET_REASON}`;
    assert.ok(usedBeforeClosing + SEPARATOR.length + nextNotice.length + SUMMARY_RESERVE_CHARS > OUTPUT_BUDGET_CHARS);
    assert.ok(usedBeforeClosing + SEPARATOR.length + closing.length <= OUTPUT_BUDGET_CHARS);
  });

  it('counts budget notices too: a notice is placed while it fits next to the reserve, then the closing line', () => {
    const blocks = [fixture('size-mid'), fixture('size-mid'), ...Array.from({ length: 45 }, () => fixture('size-small'))];
    const { output } = runStopHook(blocks.map(fence).join('\n'), { MERMAID_FOR_CLAUDE_MAX_WIDTH: '120' });
    const payload = output.systemMessage;
    assert.ok(payload.length < OUTPUT_BUDGET_CHARS, `payload is ${payload.length} chars`);

    const sections = payload.split(SEPARATOR);
    assert.equal(sections.length, 4);
    assert.equal(sections[0], renderedAt('size-mid', '1/47'));
    assert.equal(sections[1], renderedAt('size-mid', '2/47'));
    assert.equal(sections[2], `mermaid-for-claude: could not render diagram 3/47 (stateDiagram): ${BUDGET_REASON}`);
    assert.equal(sections[3], `mermaid-for-claude: diagrams 4/47 to 47/47 skipped: ${BUDGET_REASON}`);

    // The third block's diagram did not fit but its notice did; a fourth notice would have overrun the
    // reserve, so the notice already placed is what pushed the reply into the closing line.
    const usedBeforeNotice = sections.slice(0, 2).join(SEPARATOR).length;
    assert.ok(usedBeforeNotice + SEPARATOR.length + renderedAt('size-small', '3/47').length + SUMMARY_RESERVE_CHARS > OUTPUT_BUDGET_CHARS);
    assert.ok(usedBeforeNotice + SEPARATOR.length + sections[2].length + SUMMARY_RESERVE_CHARS <= OUTPUT_BUDGET_CHARS);
    const usedBeforeClosing = sections.slice(0, 3).join(SEPARATOR).length;
    const fourthNotice = `mermaid-for-claude: could not render diagram 4/47 (stateDiagram): ${BUDGET_REASON}`;
    assert.ok(usedBeforeClosing + SEPARATOR.length + fourthNotice.length + SUMMARY_RESERVE_CHARS > OUTPUT_BUDGET_CHARS);
    assert.ok(usedBeforeClosing + SEPARATOR.length + sections[3].length <= OUTPUT_BUDGET_CHARS);
  });

  it('places a width notice between rendered blocks and keeps the whole payload inside the budget', () => {
    const blocks = [fixture('size-big'), fixture('size-sequence-wide'), fixture('size-small')];
    const { output } = runStopHook(blocks.map(fence).join('\n'), { MERMAID_FOR_CLAUDE_MAX_WIDTH: '120' });
    const sections = output.systemMessage.split(SEPARATOR);
    assert.equal(sections[0], renderedAt('size-big', '1/3'));
    assert.equal(sections[1], 'mermaid-for-claude: could not render diagram 2/3 (sequenceDiagram): 208 columns wide, limit is 120');
    assert.equal(sections[2], renderedAt('size-small', '3/3'));
    assert.ok(output.systemMessage.length <= OUTPUT_BUDGET_CHARS);
  });
});
