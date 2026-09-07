/* Closer portal tour + FAQ content.
 *
 * Only role reachable here: closer. No client or staff copy in this file.
 *
 * A closer sees their own placement only. Nothing here should imply they can
 * see teammates, other clients, or record sales and payments — they cannot.
 */
(function (root) {
  "use strict";

  var C = ["closer"];

  root.PravahCloserGuide = {
    intro: "A quick pass through each section of your workspace, so you know where everything lives. About a minute.",

    steps: [
      { roles: C, view: "dashboard", target: '.nav-list',
        title: "Your five sections",
        body: "Everything is in this sidebar. Daily report is the one you will use twice a day; the rest is your book of business." },

      { roles: C, view: "dashboard", target: '.closer-metrics',
        title: "Dashboard: where you stand",
        body: "Your lifetime sales and verified cash, your target for the current period, and how far through it you are." },

      { roles: C, view: "report", target: '.slot-toggle',
        title: "Daily report: two submissions",
        body: "Midday around 3pm, end of day at close. Both are the day's running totals as of that moment, not just what happened since the last one." },

      { roles: C, view: "report", target: '#slot-status',
        title: "What you have already sent",
        body: "These chips show, for the date selected, whether each slot is in. If a figure is ever disputed you will see that here too." },

      { roles: C, view: "report", target: '#report-form',
        title: "Filling it in",
        body: "Calls, positive leads, closed deals and cash collected. Leave anything you do not have blank rather than guessing — blank reads as no data, zero reads as none happened. Submitting the same slot again just updates it." },

      { roles: C, view: "report", target: '#report-form .form-footer',
        title: "Then copy it for WhatsApp",
        body: "After you submit, a formatted message appears below the form with a copy button. Paste that straight into your group — no retyping." },

      { roles: C, view: "leads", target: '#leads .table-panel',
        title: "My leads",
        body: "The leads assigned to you. Change a stage from the dropdown, or log a call or note against any customer as you work them." },

      { roles: C, view: "pipeline", target: '#pipeline .page-actions',
        title: "My pipeline",
        body: "Create and update deals you are working. Deal value is pipeline — recording the money itself is done by the office once payment lands." },

      { roles: C, view: "targets", target: '#kra-grid',
        title: "Targets and scorecard",
        body: "Four areas: activity, pipeline, revenue and discipline. Discipline is simply whether both daily reports go in, complete and on time." },

      { roles: C, view: "dashboard", target: '[data-help-open]',
        title: "Help lives here",
        body: "Answers to common questions, and this tour again whenever you want it." }
    ],

    faq: [
      {
        title: "Daily reports",
        items: [
          { roles: C, q: "When are my reports due?",
            a: "<p>Midday around 3pm, and end of day at close. Both cover the same day.</p>" },
          { roles: C, q: "Are the figures cumulative or just since midday?",
            a: "<p>Cumulative. Both submissions are the day's running totals as of the moment you send them, so your EOD numbers include everything from the morning.</p>" },
          { roles: C, q: "I made a mistake — can I fix it?",
            a: "<p>Yes. Submit the same slot again with the right numbers and it updates in place. No need to ask anyone.</p>" },
          { roles: C, q: "I forgot yesterday's report.",
            a: "<p>You can still submit for yesterday by changing the report date. Anything older has to be entered by the office, so the record of what was claimed when stays meaningful.</p>" },
          { roles: C, q: "What if I have no number for something?",
            a: "<p>Leave it blank. Blank means no data; zero means it genuinely did not happen. The difference matters on your scorecard.</p>" },
          { roles: C, q: "What does “figures disputed” mean?",
            a: "<p>The office recorded different numbers for the same slot. Nothing is deleted — both versions are kept and someone will confirm which is right. Raise it with your manager if you disagree.</p>" }
        ]
      },
      {
        title: "WhatsApp",
        items: [
          { roles: C, q: "Do I still send my report on WhatsApp?",
            a: "<p>Yes, for now. Submit here first, then use the copy button and paste it into the group. Submitting is what counts towards your scorecard; the WhatsApp message keeps everyone informed.</p>" },
          { roles: C, q: "The copy button did nothing.",
            a: "<p>Some browsers block copying. Select the message text and copy it manually — the content is the same.</p>" }
        ]
      },
      {
        title: "Leads and deals",
        items: [
          { roles: C, q: "Why can I only see some leads?",
            a: "<p>You see the leads assigned to your placement. Teammates' leads and other clients' leads are not visible to you.</p>" },
          { roles: C, q: "Can I record a sale?",
            a: "<p>No. You log the deal and move it along; the office records the sale and verifies the payment once money arrives. This keeps cash figures backed by evidence.</p>" },
          { roles: C, q: "How do I log a call?",
            a: "<p>On My leads, use the log control on the customer's row. Pick the type, when it happened, and the outcome.</p>" }
        ]
      },
      {
        title: "Targets and scorecard",
        items: [
          { roles: C, q: "How is my score worked out?",
            a: "<p>Four weighted areas: revenue 35%, activity 30%, pipeline 20%, discipline 15%. Each is scored against target, capped at 120 so a strong month is recognised without distorting the rest.</p>" },
          { roles: C, q: "Why does an area show a dash instead of a score?",
            a: "<p>It cannot be scored yet — usually no target is set for the period. A dash means no data, deliberately, rather than showing zero and looking like failure.</p>" },
          { roles: C, q: "Who sets my target?",
            a: "<p>Get Closers, per period. Targets differ between closers, so compare yourself against your own rather than a colleague's.</p>" },
          { roles: C, q: "Does my scorecard use my numbers or the office's?",
            a: "<p>Yours. Your submissions are the measured record; the office's figures act as a check on them, not a replacement.</p>" }
        ]
      },
      {
        title: "Your account",
        items: [
          { roles: C, q: "How do I change my password?",
            a: "<p><strong>Password</strong>, at the top right beside Sign out. You stay signed in after changing it.</p>" },
          { roles: C, q: "I have forgotten my password.",
            a: "<p>Ask your manager to issue a new temporary one, then change it once you are back in. There is no automated reset email.</p>" }
        ]
      }
    ]
  };
})(window);
