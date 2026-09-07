/* Client portal tour + FAQ content.
 *
 * Roles reachable here: client_admin, client_viewer. No staff or closer copy
 * appears in this file, so a client cannot reach it by any client-side means.
 *
 * client_viewer is read-only: it must never be told to add, edit, import or
 * record anything. Those steps and answers are client_admin only.
 */
(function (root) {
  "use strict";

  var BOTH = ["client_admin", "client_viewer"];
  var ADMIN = ["client_admin"];

  root.PravahClientGuide = {
    intro: "A quick pass through each section of your workspace, so you know where everything lives. About a minute.",

    steps: [
      { roles: BOTH, view: "dashboard", target: '.nav-list',
        title: "Your seven sections",
        body: "Everything is in this sidebar, in the order you will usually need it — from the dashboard through to actions." },

      { roles: BOTH, view: "dashboard", target: '.dash-metrics',
        title: "Dashboard: the headline numbers",
        body: "Live counts for closers, leads, booked revenue and verified cash. Verified cash means a payment backed by evidence, which is why it can trail booked revenue." },

      { roles: BOTH, view: "dashboard", target: '#dash-funnel',
        title: "Where your leads are stuck",
        body: "The funnel counts leads by stage. A wide top and a narrow middle usually means qualification, not lead volume, is the constraint." },

      { roles: BOTH, view: "leads", target: '#leads .toolbar',
        title: "Leads: search and filter",
        body: "Search by name, email or phone. Narrow by stage or by tag. The count under the table tells you how many of your total leads the current filter matches." },

      { roles: ADMIN, view: "leads", target: '#lead-actions',
        title: "Adding leads, one or many",
        body: "Add a single lead here, or export the current filtered view to CSV. For a whole spreadsheet, use Import — it maps your column names for you." },

      { roles: BOTH, view: "leads", target: '#lead-rows',
        title: "Open any customer",
        body: "Click a customer's name for their full history: contact details, tags, every deal, every sale, and a timeline of all activity logged against them." },

      { roles: BOTH, view: "pipeline", target: '#pipeline .table-panel',
        title: "Pipeline: open deals",
        body: "Deals in flight, with expected value and close date. Deal value is pipeline, not booked revenue — it only becomes revenue when a sale is recorded." },

      { roles: BOTH, view: "sales", target: '#sales .client-metrics',
        title: "Sales and cash",
        body: "Booked revenue against cash actually collected, for all time and month to date. The gap between the two is your collections position." },

      { roles: ADMIN, view: "import", target: '.step-indicator',
        title: "Import: three steps",
        body: "Upload or paste a CSV, check the column mapping it guesses for you, then validate and import. Valid rows import even when others need repair, and re-running the same file will not duplicate anything." },

      { roles: BOTH, view: "closers", target: '#closers .table-panel',
        title: "Your closers",
        body: "The closers assigned to you, their training status, and their performance reports period by period." },

      { roles: BOTH, view: "actions", target: '#actions .table-panel',
        title: "Actions and check-ins",
        body: "Open follow-ups agreed with your account manager, and the full history of your check-ins with their health rating." },

      { roles: BOTH, view: "dashboard", target: '[data-help-open]',
        title: "Help lives here",
        body: "Answers to common questions, and this tour again whenever you want it." }
    ],

    faq: [
      {
        title: "Leads and pipeline",
        items: [
          { roles: BOTH, q: "What do the lead stages mean?",
            a: "<p>Stages are shared across Get Closers so every client is measured the same way. A lead moves from first contact through qualification and a booked conversation to won or lost.</p><p>Only the stage list your account is configured with will appear in the dropdowns.</p>" },
          { roles: ADMIN, q: "How do I move a lead to another stage?",
            a: "<p>Use the dropdown in the lead's row on the Leads table — it saves as soon as you choose. To move several at once, tick their checkboxes and use <strong>Update stage</strong> in the bar above the table.</p>" },
          { roles: BOTH, q: "What is the difference between a deal and a sale?",
            a: "<p>A <strong>deal</strong> is an opportunity you expect to close — its value is pipeline. A <strong>sale</strong> is money actually agreed. Pipeline never counts as revenue until a sale is recorded against it.</p>" },
          { roles: ADMIN, q: "What are tags for?",
            a: "<p>Anything you want to slice by that a stage does not cover — campaign, region, priority. Add them in a lead's edit form, comma separated, then filter by tag on the Leads toolbar.</p>" },
          { roles: BOTH, q: "Why can I not see a lead a colleague mentioned?",
            a: "<p>You only ever see leads belonging to your own company. If a lead is genuinely missing, it was either recorded against a different client or has not been imported yet.</p>" }
        ]
      },
      {
        title: "Revenue and cash",
        items: [
          { roles: BOTH, q: "Why is verified cash lower than booked revenue?",
            a: "<p>Booked revenue is what was sold. Verified cash is what has been received <em>and</em> backed by payment evidence checked by Get Closers. The difference is money sold but not yet collected or not yet evidenced.</p>" },
          { roles: ADMIN, q: "I recorded a sale but revenue has not moved.",
            a: "<p>Refresh the dashboard first. If it still has not moved, check the sale's net amount was entered — a sale with a zero net contributes nothing.</p>" },
          { roles: BOTH, q: "Can I see cash collected per closer?",
            a: "<p>Yes, on the Closers section. Their reports show cash reported for each period alongside the amount verified.</p>" }
        ]
      },
      {
        title: "Importing your data",
        items: [
          { roles: ADMIN, q: "Do I need to reformat my spreadsheet first?",
            a: "<p>No. The import wizard reads your column headings and maps the ones it recognises — name, phone, email, status, date, duration, notes and their common variants. You correct anything it guesses wrong before importing.</p>" },
          { roles: ADMIN, q: "What happens to rows with problems?",
            a: "<p>They are held back and counted as needing repair. Valid rows import regardless, so a few bad rows never block a good file.</p>" },
          { roles: ADMIN, q: "Is it safe to import the same file twice?",
            a: "<p>Yes. Rows are matched on a source record key, so a re-run skips anything already imported rather than duplicating it.</p>" },
          { roles: ADMIN, q: "Can I import call logs, not just leads?",
            a: "<p>Yes — choose the Callyzer call log parser on the first step. Calls are attached to the matching customer as activity.</p>" }
        ]
      },
      {
        title: "Your account",
        items: [
          { roles: BOTH, q: "How do I change my password?",
            a: "<p><strong>Password</strong>, at the top right beside Sign out. You stay signed in after changing it.</p>" },
          { roles: BOTH, q: "I have forgotten my password.",
            a: "<p>Ask your account manager to issue a new temporary one, then change it once you are back in. There is no automated reset email.</p>" },
          { roles: ["client_viewer"], q: "Why can I not add or edit anything?",
            a: "<p>Your account is a viewer, which is read-only by design. Ask your account manager to upgrade you to client admin if you need to record leads, deals or sales.</p>" },
          { roles: ADMIN, q: "Can I add colleagues myself?",
            a: "<p>Not from this portal. Ask your account manager, who can create accounts for your company as either admin or viewer.</p>" },
          { roles: BOTH, q: "Who can see our data?",
            a: "<p>Only accounts belonging to your company, plus Get Closers staff supporting you. Isolation is enforced by the database on every request, not by the interface.</p>" }
        ]
      }
    ]
  };
})(window);
