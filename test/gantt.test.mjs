// The gantt built-in renderer (ticket #25, ADR-0007) driven through the Stop hook seam: the six gantt
// fixtures behave as in ADR-0007 (five render, the bad date gives a notice), the axis compresses to
// MERMAID_FOR_CLAUDE_MAX_WIDTH=76 with every row on one line and the bars aligned with the axis,
// `excludes weekends` extends duration-based tasks as mermaid does, MERMAID_FOR_CLAUDE_ASCII=1 swaps
// every glyph, and the semantic notices are short. Snapshots are compared at a fixed width of 120.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fence, fixture, runStopHook, snapshot } from './seams/stop-hook.mjs';

const WIDE = { MERMAID_FOR_CLAUDE_MAX_WIDTH: '120', MERMAID_FOR_CLAUDE_ASCII: undefined };
const ASCII = { ...WIDE, MERMAID_FOR_CLAUDE_ASCII: '1' };
const NARROW = { ...WIDE, MERMAID_FOR_CLAUDE_MAX_WIDTH: '76' };

const notice = (reason) => `mermaid-for-claude: could not render diagram 1/1 (gantt): ${reason}`;
const rowsOf = (text) => text.split('\n');
const widestRow = (text) => Math.max(...rowsOf(text).map((row) => [...row].length));
const ANSI_ESCAPE = /\x1b\[/;
const EMOJI = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const BAR_GLYPHS = /[█░▒◆]/;

const RENDERED = ['gantt', 'gantt-plain', 'gantt-after-until', 'gantt-times', 'gantt-vert'];

// The axis rule row starts with `┼` after the label column; its index is where every bar area begins.
const axisOf = (text) => {
  const rows = rowsOf(text);
  const ruleIndex = rows.findIndex((row) => /^ +[┼+]/.test(row));
  assert.ok(ruleIndex > 0, 'axis rule row found');
  const indent = rows[ruleIndex].search(/[┼+]/);
  return { rows, labelRow: rows[ruleIndex - 1], ruleRow: rows[ruleIndex], indent };
};

const render = (source, env = WIDE) => runStopHook(fence(source), env).output.systemMessage;

describe('rendering the gantt fixtures', () => {
  for (const name of RENDERED) {
    it(`renders the ${name} fixture as in ADR-0007`, () => {
      const output = render(fixture(name));
      assert.equal(output, snapshot(name));
      assert.match(output, /^mermaid-for-claude: diagram 1\/1 \(gantt\)\n/);
      assert.doesNotMatch(output, ANSI_ESCAPE);
      assert.doesNotMatch(output, EMOJI);
      assert.ok(widestRow(output) <= 120);
    });
  }

  it('gives a notice for the gantt-bad-date fixture, whose dateFormat carries MMM', () => {
    assert.equal(render(fixture('gantt-bad-date')), notice('unsupported dateFormat token: MMM'));
  });

  it('draws a vert marker at the task start with its title under the chart', () => {
    const output = render(fixture('gantt-vert'));
    const { rows, indent } = axisOf(output);
    const taskA = rows.find((row) => row.startsWith('Task A'));
    assert.equal(taskA[indent], '┆', 'the first vert stands at the chart start, on every task row');
    const titles = rows.filter((row) => /Initial vert|Final vert/.test(row));
    assert.equal(titles.length, 2);
    assert.ok(titles.every((row) => row.includes('┆') && !BAR_GLYPHS.test(row)));
  });

  it('starts the axis at the chart start and lists only the states used in the legend', () => {
    const output = render(fixture('gantt-after-until'));
    const { labelRow, ruleRow, indent } = axisOf(output);
    assert.equal(labelRow.slice(indent, indent + 10), '2017-07-20', 'the default axisFormat is %Y-%m-%d');
    assert.equal(ruleRow[indent], '┼');
    assert.match(output, /█ planned {3}▒ active$/);
    assert.doesNotMatch(output, /done|milestone/);
  });

  it('defaults the axis to %H:%M when the date format carries no date', () => {
    const output = render('gantt\n    dateFormat HH:mm\n    Task A :a, 09:00, 30m\n    Task B :after a, 1h\n');
    const { labelRow } = axisOf(output);
    assert.match(labelRow, /^ +09:00( +\d\d:\d\d)+$/);
    assert.doesNotMatch(labelRow, /1970/);
  });

  it('ignores todayMarker, topAxis, weekday, displayMode and click lines', () => {
    const source = [
      'gantt',
      '    dateFormat YYYY-MM-DD',
      '    todayMarker off',
      '    topAxis',
      '    weekday monday',
      '    displayMode compact',
      '    Task A :a, 2024-01-01, 2d',
      '    click a href "https://example.com"',
      '',
    ].join('\n');
    const output = render(source);
    assert.match(output, /^mermaid-for-claude: diagram 1\/1 \(gantt\)\n/);
    assert.match(output, /^Task A {2}█+$/m);
  });
});

describe('excludes weekends', () => {
  it('extends a 3d task across a weekend as mermaid does, with the bar skipping the excluded days', () => {
    const output = render(fixture('gantt-excludes'));
    assert.equal(output, snapshot('gantt-excludes'));
    const { rows, labelRow, indent } = axisOf(output);
    const dayColumn = (day) => labelRow.indexOf(day, indent) - indent;
    const bar = (title) => {
      const cells = rows.find((row) => row.startsWith(title)).slice(indent);
      return { first: cells.search(BAR_GLYPHS), last: cells.search(/[█░▒◆](?![█░▒◆])/) };
    };
    // Thursday 2024-01-04 + 3d counts Thursday, Friday and Monday: ends Tuesday 09.
    assert.deepEqual(bar('Thursday start'), { first: dayColumn('04'), last: dayColumn('09') - 1 });
    assert.equal(bar('After a').first, dayColumn('09'));
    // Friday 05 + 3d counts Friday, Monday and Tuesday: ends Wednesday 10.
    assert.deepEqual(bar('Friday start'), { first: dayColumn('05'), last: dayColumn('10') - 1 });
    // Thursday 04 + 2d ends on Saturday 06: the bar stops there, the dependent starts on Monday 08.
    assert.deepEqual(bar('Ends Saturday'), { first: dayColumn('04'), last: dayColumn('06') - 1 });
    assert.equal(bar('After d').first, dayColumn('08'));
  });

  it('does not extend a task whose end is an explicit date', () => {
    const source = 'gantt\n    dateFormat YYYY-MM-DD\n    axisFormat %d\n    tickInterval 1day\n    excludes weekends\n    Fixed :a, 2024-01-04, 2024-01-08\n    Next :after a, 1d\n';
    const { rows, labelRow, indent } = axisOf(render(source));
    const next = rows.find((row) => row.startsWith('Next')).slice(indent);
    assert.equal(next.search(BAR_GLYPHS), labelRow.indexOf('08', indent) - indent);
  });

  it('extends a task longer than 10,000 days instead of giving up', () => {
    const output = render('gantt\n    dateFormat YYYY-MM-DD\n    excludes weekends\n    Long :a, 2024-01-01, 12000d\n');
    assert.match(output, /^mermaid-for-claude: diagram 1\/1 \(gantt\)\n/);
  });

  it('honours weekend friday, includes and named weekdays', () => {
    const source = 'gantt\n    dateFormat YYYY-MM-DD\n    axisFormat %d\n    tickInterval 1day\n    excludes weekends, wednesday\n    includes 2024-01-05\n    weekend friday\n    Task :a, 2024-01-02, 3d\n    Next :after a, 1d\n';
    const { rows, labelRow, indent } = axisOf(render(source));
    // Tuesday 02 + 3d: Wednesday 03 excluded, Thursday 04 counts, Friday 05 included, Saturday 06 excluded: ends Sunday 07.
    const next = rows.find((row) => row.startsWith('Next')).slice(indent);
    assert.equal(next.search(BAR_GLYPHS), labelRow.indexOf('07', indent) - indent);
  });
});

describe('durations', () => {
  const chart = (tasks) => `gantt\n    dateFormat YYYY-MM-DD\n    axisFormat %d\n    tickInterval 1day\n${tasks}\n`;
  const startOfNext = (source) => {
    const { rows, labelRow, indent } = axisOf(render(source));
    const next = rows.find((row) => row.startsWith('Next')).slice(indent);
    return labelRow.slice(next.search(BAR_GLYPHS) + indent, next.search(BAR_GLYPHS) + indent + 2);
  };

  it('rounds a decimal day or week duration to whole days as dayjs does', () => {
    assert.equal(startOfNext(chart('    Task :a, 2024-01-01, 1.5d\n    Next :after a, 1d')), '03');
    assert.equal(startOfNext(chart('    Task :a, 2024-01-01, 0.4d\n    Next :after a, 1d')), '01');
  });

  it('adds hours exactly and weeks by seven days', () => {
    assert.equal(startOfNext(chart('    Task :a, 2024-01-01, 48h\n    Next :after a, 1d')), '03');
    assert.equal(startOfNext(chart('    Task :a, 2024-01-01, 1w\n    Next :after a, 1d')), '08');
  });

  it('keeps the day of the month when adding months, clamped to the target month as dayjs does', () => {
    // `Next` starts where the task ends; `Ref` starts on the day dayjs would give, so the two bars line up.
    const startsTogether = (task, reference) => {
      const { rows } = axisOf(render(`gantt\n    dateFormat YYYY-MM-DD\n    Task :a, ${task}\n    Next :after a, 1d\n    Ref :r, ${reference}, 1d\n`));
      const firstBar = (title) => rows.find((row) => row.startsWith(title)).search(BAR_GLYPHS);
      assert.equal(firstBar('Next'), firstBar('Ref'));
    };
    startsTogether('2024-01-31, 1M', '2024-02-29');
    startsTogether('2024-02-29, 1y', '2025-02-28');
  });

  it('adds inclusiveEndDates one day to an explicit end date', () => {
    const source = 'gantt\n    dateFormat YYYY-MM-DD\n    axisFormat %d\n    tickInterval 1day\n    inclusiveEndDates\n    Task :a, 2024-01-01, 2024-01-03\n    Next :after a, 1d\n';
    assert.equal(startOfNext(source), '04');
  });
});

describe('MERMAID_FOR_CLAUDE_ASCII=1', () => {
  it('draws the gantt fixture with ASCII glyphs only', () => {
    const output = render(fixture('gantt'), ASCII);
    assert.equal(output, snapshot('gantt.ascii'));
    assert.match(output, /^[\x20-\x7e\n]*$/, 'every character is printable ASCII');
    assert.match(output, /# planned {3}\. done {3}= active {3}\* milestone/);
  });

  it('swaps the vert marker and the ellipsis', () => {
    const output = render(fixture('gantt-vert'), ASCII);
    assert.match(output, /^[\x20-\x7e\n]*$/);
    assert.match(output, /^Task A {2}:/m);
    const cut = render(fixture('gantt'), { ...ASCII, MERMAID_FOR_CLAUDE_MAX_WIDTH: '76' });
    assert.match(cut, /Completed task in\.\.\. {2}\.\./);
  });
});

describe('MERMAID_FOR_CLAUDE_MAX_WIDTH=76', () => {
  it('compresses the axis, keeps every row on one line and the bars aligned with the axis', () => {
    const wide = render(fixture('gantt'));
    const output = render(fixture('gantt'), NARROW);
    assert.equal(output, snapshot('gantt.narrow'));
    assert.ok(widestRow(output) <= 76, `widest row is ${widestRow(output)}`);
    assert.equal(rowsOf(output).length, rowsOf(wide).length, 'one line per row, as at 120 columns');
    const { rows, ruleRow, indent } = axisOf(output);
    assert.ok(indent - 2 <= Math.floor(76 * 0.3), `label column is ${indent - 2} columns`);
    assert.equal(ruleRow.trimEnd().length, 76 - 5, 'the rule spans the bar area, leaving the crit column');
    const taskRows = rows.filter((row) => BAR_GLYPHS.test(row) && !row.includes('planned'));
    assert.equal(taskRows.length, 17);
    for (const row of taskRows) {
      assert.doesNotMatch(row.slice(0, indent), BAR_GLYPHS, `no bar glyph inside the label column: ${row}`);
      assert.ok(row.search(BAR_GLYPHS) >= indent);
    }
    assert.match(output, /Completed task in t… {2}░/);
  });

  for (const name of RENDERED) {
    it(`fits the ${name} fixture inside 76 columns`, () => {
      const output = render(fixture(name), NARROW);
      assert.match(output, /^mermaid-for-claude: diagram 1\/1/);
      assert.ok(widestRow(output) <= 76, `widest row is ${widestRow(output)}`);
    });
  }

  it('climbs the tick ladder until the formatted labels no longer overlap, first tick at the chart start', () => {
    const output = render(fixture('gantt-plain'), NARROW);
    const { labelRow, indent } = axisOf(output);
    assert.equal(labelRow.slice(indent, indent + 6), 'Sep 10');
    const tokens = labelRow.trim().split(/\s+/);
    assert.ok(tokens.length >= 4, 'more than one tick label');
    tokens.forEach((token, index) => assert.match(token, index % 2 === 0 ? /^Sep$/ : /^\d\d$/));
    assert.match(labelRow, /Sep 10 {2,}Sep/, 'a coarser step than at 120 columns');
  });

  it('places tickInterval ticks as d3 does: restarting at the month for days, Sundays and milliseconds from the epoch', () => {
    const labelsOf = (source) => axisOf(render(source)).labelRow.trim().split(/\s+/);
    const chart = (axisFormat, tickInterval, task, dateFormat = 'YYYY-MM-DD') => `gantt\n    dateFormat ${dateFormat}\n    axisFormat ${axisFormat}\n    tickInterval ${tickInterval}\n    Task :a, ${task}\n`;
    assert.deepEqual(labelsOf(chart('%d', '2day', '2024-01-04, 10d')), ['04', '05', '07', '09', '11', '13']);
    assert.deepEqual(labelsOf(chart('%d', '1week', '2024-01-04, 20d')), ['04', '07', '14', '21']);
    assert.deepEqual(labelsOf(chart('%H', '12hour', '2024-01-04, 2d')), ['00', '12', '00', '12']);
    assert.deepEqual(labelsOf(chart('%m', '1month', '2024-01-15, 100d')), ['01', '02', '03', '04']);
    assert.deepEqual(labelsOf(chart('%S.%L', '700millisecond', '1000, 2500ms', 'x')), ['01.000', '01.400', '02.100', '02.800']);
  });

  it('gives a notice below about 32 columns', () => {
    assert.equal(render(fixture('gantt-plain'), { ...WIDE, MERMAID_FOR_CLAUDE_MAX_WIDTH: '31' }), notice('needs more than 31 columns'));
    assert.match(render(fixture('gantt-plain'), { ...WIDE, MERMAID_FOR_CLAUDE_MAX_WIDTH: '32' }), /^mermaid-for-claude: diagram 1\/1/);
  });
});

describe('notices', () => {
  it('gives a notice for a first task without a start', () => {
    assert.equal(render('gantt\n    dateFormat YYYY-MM-DD\n    Task A :3d\n'), notice('first task needs a start date'));
  });

  it('gives a notice for an unknown id', () => {
    assert.equal(render('gantt\n    dateFormat YYYY-MM-DD\n    Task A :a, 2024-01-01, 1d\n    Task B :after zz, 1d\n'), notice('unknown id: zz'));
    assert.equal(render('gantt\n    dateFormat YYYY-MM-DD\n    Task A :a, 2024-01-01, until zz\n'), notice('unknown id: zz'));
  });

  it('gives a notice for a duplicate id', () => {
    assert.equal(render('gantt\n    dateFormat YYYY-MM-DD\n    Task A :a, 2024-01-01, 1d\n    Task B :a, 2024-01-02, 1d\n'), notice('duplicate id: a'));
  });

  it('gives a notice for a reference cycle instead of looping', () => {
    const source = 'gantt\n    dateFormat YYYY-MM-DD\n    Task A :a, after b, 1d\n    Task B :b, after a, 1d\n';
    assert.equal(render(source), notice('unresolved reference: Task A :a, after b, 1d'));
  });

  it('gives a notice for an unparsable date', () => {
    assert.equal(render('gantt\n    dateFormat YYYY-MM-DD\n    Task A :a, 2024-13-01, 1d\n'), notice('bad date: 2024-13-01'));
    assert.equal(render('gantt\n    dateFormat YYYY-MM-DD\n    Task A :a, 5 Jan 2024, 1d\n'), notice('bad date: 5 Jan 2024'));
  });

  it('gives a notice for an unknown duration or end', () => {
    assert.equal(render('gantt\n    dateFormat YYYY-MM-DD\n    Task A :a, 2024-01-01, 3 days\n'), notice('bad end or duration: 3 days'));
  });

  it('gives a notice for an unsupported axisFormat directive', () => {
    assert.equal(render('gantt\n    dateFormat YYYY-MM-DD\n    axisFormat %q\n    Task A :a, 2024-01-01, 1d\n'), notice('unsupported axisFormat directive: %q'));
  });

  it('gives the unsupported line notice for a line outside the grammar subset', () => {
    assert.equal(render('gantt\n    dateFormat YYYY-MM-DD\n    Task A without data\n'), notice('unsupported line: Task A without data'));
    assert.equal(render('gantt chart\n    Task A :a, 2024-01-01, 1d\n'), notice('unsupported line: gantt chart'));
  });

  it('gives a notice for a chart without tasks', () => {
    assert.equal(render('gantt\n    title Empty\n'), notice('no tasks'));
  });
});
