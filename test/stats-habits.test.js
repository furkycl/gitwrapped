import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { computeBiggestCommit, computeCoAuthors, computeCommitSizes, computeFirstCommit, computeCommitTypes, computeContributors, computeEmoji, computeReverts, computeDaily, computeHotFiles, computeLanguages, computeMessages, computeMonths, computePersonality, computeReleases, computeStats, computeStreaks, computeTimeHabits, computeTotals, hourLabel } from '../src/stats/index.js';
import { readCommits } from '../src/git.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const at = (date) => ({ hash: 'h', author: 'A', email: 'a@x.io', date, subject: 's', files: [],
  filesChanged: 0, linesAdded: 0, linesRemoved: 0 });

describe('hourLabel', () => {
  test('12-hour labels with midnight and noon', () => {
    assert.equal(hourLabel(0), '12 AM');
    assert.equal(hourLabel(9), '9 AM');
    assert.equal(hourLabel(11), '11 AM');
    assert.equal(hourLabel(12), '12 PM');
    assert.equal(hourLabel(13), '1 PM');
    assert.equal(hourLabel(23), '11 PM');
    assert.equal(hourLabel(null), null);
    assert.equal(hourLabel(24), null);
  });
});

describe('computeTimeHabits', () => {
  test('empty input → zero arrays and null peaks', () => {
    for (const input of [[], undefined, null]) {
      const h = computeTimeHabits(input);
      assert.deepEqual(h.byHour, new Array(24).fill(0));
      assert.deepEqual(h.byWeekday, new Array(7).fill(0));
      assert.equal(h.peakHour, null);
      assert.equal(h.peakWeekday, null);
      assert.equal(h.peakHourLabel, null);
      assert.equal(h.peakHourCount, 0);
      assert.equal(h.peakWeekdayCount, 0);
      assert.equal(h.peakHourTied, false);
      assert.equal(h.peakWeekdayTied, false);
      assert.equal(h.peakWeekdayName, null);
    }
  });

  test('23:30+02:00 counts at hour 23 on its local weekday', () => {
    const h = computeTimeHabits([at('2024-06-15T23:30:00+02:00')]); // Saturday local, 21:30Z
    assert.equal(h.byHour[23], 1);
    assert.equal(h.byHour[21], 0);
    assert.equal(h.byWeekday[6], 1);
    assert.equal(h.peakHour, 23);
    assert.equal(h.peakHourLabel, '11 PM');
    assert.equal(h.peakWeekday, 6);
    assert.equal(h.peakWeekdayName, 'Saturday');
    assert.equal(h.peakHourCount, 1);
    assert.equal(h.peakHourTied, false);
  });

  test('-08:00 and Z offsets use local wall-clock time', () => {
    const h = computeTimeHabits([
      at('2024-03-10T20:15:00-08:00'), // Sunday 20h local (Monday 04h UTC)
      at('2024-03-11T04:15:00Z'), // Monday 04h
    ]);
    assert.equal(h.byHour[20], 1);
    assert.equal(h.byHour[4], 1);
    assert.equal(h.byWeekday[0], 1);
    assert.equal(h.byWeekday[1], 1);
  });

  test('midnight and noon peaks are labelled 12 AM / 12 PM', () => {
    assert.equal(computeTimeHabits([at('2024-06-15T00:05:00Z')]).peakHourLabel, '12 AM');
    assert.equal(computeTimeHabits([at('2024-06-15T12:59:00+09:00')]).peakHourLabel, '12 PM');
    assert.equal(computeTimeHabits([at('2024-06-15T09:00:00Z')]).peakHourLabel, '9 AM');
  });

  test('clear peak wins; ties go to the earliest hour and weekday', () => {
    const clear = computeTimeHabits([at('2024-06-15T22:00:00Z'), at('2024-06-16T22:10:00Z'), at('2024-06-17T08:00:00Z')]);
    assert.equal(clear.peakHour, 22);
    assert.equal(clear.peakHourCount, 2);
    assert.equal(clear.peakHourTied, false);
    const tie = computeTimeHabits([
      at('2024-06-14T22:00:00Z'), // Friday
      at('2024-06-11T07:00:00Z'), // Tuesday
      at('2024-06-14T22:30:00Z'), // Friday
      at('2024-06-11T07:30:00Z'), // Tuesday
    ]);
    assert.equal(tie.peakHour, 7);
    assert.equal(tie.peakHourLabel, '7 AM');
    assert.equal(tie.peakWeekday, 2);
    assert.equal(tie.peakWeekdayName, 'Tuesday');
    assert.equal(tie.peakHourCount, 2);
    assert.equal(tie.peakWeekdayCount, 2);
    assert.equal(tie.peakHourTied, true);
    assert.equal(tie.peakWeekdayTied, true);
  });

  test('tie flags compare only against the maximum count', () => {
    // 07h ×3 (Tue), 09h ×1 (Tue), 22h ×1 (Fri): lower counts may tie, the peak does not.
    const h = computeTimeHabits([
      at('2024-06-11T07:00:00Z'), at('2024-06-11T07:10:00Z'), at('2024-06-11T07:20:00Z'),
      at('2024-06-11T09:00:00Z'), at('2024-06-14T22:00:00Z'),
    ]);
    assert.equal(h.peakHour, 7);
    assert.equal(h.peakHourCount, 3);
    assert.equal(h.peakHourTied, false);
    assert.equal(h.peakWeekday, 2);
    assert.equal(h.peakWeekdayCount, 4);
    assert.equal(h.peakWeekdayTied, false);
  });

  test('unparseable dates are skipped', () => {
    const h = computeTimeHabits([at('nope'), at('2024-06-15T09:00:00Z')]);
    assert.equal(h.byHour.reduce((a, b) => a + b, 0), 1);
    assert.equal(h.peakHour, 9);
  });
});

describe('computeStats', () => {
  test('combines totals, habits, streaks, daily, busiest day, months, hot files, languages, contributors, messages, biggest commit, commit sizes, commit types, emoji, reverts, first commit, co-authors, releases and personality', () => {
    const commits = [at('2024-06-15T09:00:00Z')];
    const today = '2024-06-16';
    const parts = {
      totals: computeTotals(commits),
      habits: computeTimeHabits(commits),
      streaks: computeStreaks(commits, { today }),
      daily: computeDaily(commits),
      busiestDay: computeDaily(commits).busiest,
      months: computeMonths(commits),
      hotFiles: computeHotFiles(commits),
      languages: computeLanguages(commits),
      contributors: computeContributors(commits),
      messages: computeMessages(commits),
      biggestCommit: computeBiggestCommit(commits),
      commitSizes: computeCommitSizes(commits),
      commitTypes: computeCommitTypes(commits),
      emoji: computeEmoji(commits),
      reverts: computeReverts(commits),
      firstCommit: computeFirstCommit(commits),
      coAuthors: computeCoAuthors(commits),
      releases: computeReleases(commits),
    };
    assert.deepEqual(computeStats(commits, { today }), { ...parts, personality: computePersonality(parts) });
    assert.equal(computeStats([]).totals.commits, 0);
    assert.equal(computeStats().habits.peakHour, null);
  });
});

describe('stats on the fixture repo (integration)', () => {
  let fixture;
  let commits;
  before(async () => {
    fixture = makeFixtureRepo();
    commits = await readCommits(fixture.dir);
  });
  after(() => fixture?.cleanup());

  test('totals match the fixture history', () => {
    // Dates (author-local): 03-04 Mon 10h, 03-05 Tue 14h, 03-06 Wed 23h, 03-09 Sat 11h,
    // 03-10 Sun 02h (-08:00), 03-11 Mon 09h, 03-12 Tue 16h (+05:30), 03-13 Wed 12h.
    assert.deepEqual(computeTotals(commits), {
      commits: 8,
      activeDays: 8,
      linesAdded: 25,
      linesRemoved: 12,
      // README.md, package-lock.json, src/app.js, notes/my notes.txt, logo.png, src/main.js
      filesTouched: 6,
      firstCommitDate: '2024-03-04T10:00:00+01:00',
      lastCommitDate: commits[0].date, // 2024-03-13T12:00:00+00:00 (git may print Z)
      firstDay: '2024-03-04',
      lastDay: '2024-03-13',
      authors: 2,
    });
    assert.equal(Date.parse(commits[0].date), Date.parse('2024-03-13T12:00:00Z'));
  });

  test('habits match the fixture history', () => {
    const h = computeTimeHabits(commits);
    const byHour = new Array(24).fill(0);
    for (const hour of [10, 14, 23, 11, 2, 9, 16, 12]) byHour[hour] += 1;
    assert.deepEqual(h.byHour, byHour);
    assert.deepEqual(h.byWeekday, [1, 2, 2, 2, 0, 0, 1]);
    assert.equal(h.peakHour, 2); // all hours tie at 1 → earliest
    assert.equal(h.peakHourLabel, '2 AM');
    assert.equal(h.peakHourCount, 1);
    assert.equal(h.peakHourTied, true);
    assert.equal(h.peakWeekday, 1); // Mon/Tue/Wed tie at 2 → Monday
    assert.equal(h.peakWeekdayName, 'Monday');
    assert.equal(h.peakWeekdayCount, 2);
    assert.equal(h.peakWeekdayTied, true);
  });

  test('readCommits output and the fixture expectations give the same stats', () => {
    const today = '2024-03-14';
    assert.deepEqual(computeStats(commits, { today }), computeStats(fixture.commits, { today }));
  });
});
