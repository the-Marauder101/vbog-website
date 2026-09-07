/* Operations portal tour + FAQ content.
 *
 * Roles reachable here: gc_admin, operations, trainer, client_success.
 * pravah_context() rejects external roles before this portal renders, and
 * app.js redirects non-internal accounts to the launcher.
 *
 * gc_admin-only surfaces (Portal, Team, cash verification, alert thresholds)
 * are marked ADMIN. Staff roles never see that copy.
 */
(function (root) {
  "use strict";

  var ALL = ["gc_admin", "operations", "trainer", "client_success"];
  var ADMIN = ["gc_admin"];

  root.PravahOpsGuide = {
    intro: "A quick pass through each section of the operations workspace, so you know where everything lives. About a minute.",

    steps: [
      { roles: ALL, view: "overview", target: '.nav-list',
        title: "The operations sections",
        body: "Overview through to team, in roughly the order work flows: what needs attention, then training, closers, clients, reports and connections." },

      { roles: ALL, view: "overview", target: '#attention-rows',
        title: "Overview: the attention queue",
        body: "The one list to read first. Overdue actions and closers flagged at high training risk surface here, alongside clients with no recent sale and cash reported but not yet verified." },

      { roles: ALL, view: "training", target: '#training .table-panel',
        title: "Training and placements",
        body: "Start training for a new placement, add checkpoints as it progresses, and mark the outcome. Training status is what drives whether a closer counts as sales-ready." },

      { roles: ALL, view: "closers", target: '#closers .table-panel',
        title: "Active closers",
        body: "Every placement with its state and performance. Set a per-period target here — targets differ between closers and drive their scorecards." },

      { roles: ALL, view: "clients", target: '#clients .table-panel',
        title: "Clients",
        body: "Open any client for their profile, check-in history and open actions. Records with no placements or history yet are listed too, marked rather than hidden." },

      { roles: ADMIN, view: "clients", target: '#clients .table-panel',
        title: "Client alert thresholds",
        body: "Inside a client you can set how many days without a sale before they are flagged — four by default, longer for B2B cycles — and their check-in cadence. Administrators only." },

      { roles: ALL, view: "reports", target: '#reports .table-panel',
        title: "Reports and cash",
        body: "Closer performance period by period. Reported cash and verified cash are deliberately separate: verification requires evidence, and a report can be voided with a reason without vanishing from the audit trail." },

      { roles: ALL, view: "connections", target: '#connections .table-panel',
        title: "Connections: Vyom handoff",
        body: "Incoming clients and candidates from Vyom. Linking is deliberately manual — names are only hints, and a wrong automatic match is worse than an unlinked record." },

      { roles: ADMIN, view: "portal", target: '#portal .table-panel',
        title: "Portal access",
        body: "Create client admin, client viewer and closer accounts with a temporary password. No email is sent, so send the details on directly; they can change the password themselves." },

      { roles: ADMIN, view: "team", target: '#team .table-panel',
        title: "Team",
        body: "Add internal staff and administrators the same way — email, role and a temporary password. Also where you deactivate someone who has left." },

      { roles: ALL, view: "overview", target: '[data-help-open]',
        title: "Help lives here",
        body: "Answers to common questions, and this tour again whenever you want it." }
    ],

    faq: [
      {
        title: "Reports and cash",
        items: [
          { roles: ALL, q: "What is the difference between reported and verified cash?",
            a: "<p>Reported cash is what was claimed. Verified cash has been checked against payment evidence. Company revenue figures and the cash KPIs use the verified number only.</p>" },
          { roles: ADMIN, q: "How do I verify cash on a report?",
            a: "<p>Open the report from the Reports section and use verify. You are recording that you have seen evidence, so only verify what you have actually checked.</p>" },
          { roles: ALL, q: "A closer's numbers look wrong. What happens?",
            a: "<p>If a closer submitted for the same day and slot and the figures differ, the pair is flagged automatically the moment the second one is written, and appears in the attention queue. Resolving it records which figure was accepted and why — neither original is edited.</p>" },
          { roles: ALL, q: "Should I void a report or correct it?",
            a: "<p>Correct it if the numbers were simply mistyped. Void it, with a reason, if the report should never have existed. A voided report stays in the audit history and drops out of KPIs.</p>" }
        ]
      },
      {
        title: "Closers and training",
        items: [
          { roles: ALL, q: "When does a closer count as active?",
            a: "<p>When their placement state is active and their training status is active or passed. Both matter — a placement alone does not make someone sales-ready.</p>" },
          { roles: ALL, q: "How do targets work?",
            a: "<p>Per placement, per period, with their own value and unit — cash, sales or revenue. Different closers can carry entirely different targets, which is why attainment is always read against their own.</p>" },
          { roles: ALL, q: "A closer's scorecard shows dashes.",
            a: "<p>Those areas cannot be scored. Usually no target is set for the period. Dashes are deliberate — showing zero would read as failure rather than missing data.</p>" }
        ]
      },
      {
        title: "Clients and Vyom",
        items: [
          { roles: ALL, q: "Why do I have to link Vyom clients by hand?",
            a: "<p>Vyom and Pravah hold different identifiers for the same company and names are unreliable. A wrong automatic match would corrupt a client's whole history, so a person confirms every link. Both identifiers are then kept permanently.</p>" },
          { roles: ALL, q: "A client appears with nothing against it.",
            a: "<p>That is expected for a newly created record. Clients with no placements, check-ins or actions are listed and marked rather than hidden, so you can still open and edit them.</p>" },
          { roles: ADMIN, q: "Can I delete a client?",
            a: "<p>Only one with no dependent history. Anything with placements, reports or revenue must be archived instead, which preserves the record.</p>" }
        ]
      },
      {
        title: "Accounts and access",
        items: [
          { roles: ADMIN, q: "How do I add someone?",
            a: "<p>Staff and administrators from <strong>Team</strong>; client and closer accounts from <strong>Portal</strong>. Both take a temporary password and create the account immediately.</p>" },
          { roles: ADMIN, q: "Why is no invitation email sent?",
            a: "<p>No mail service is configured, so an invitation would never arrive. Accounts are created directly with a password you set and pass on. Send it over WhatsApp; they change it on first sign-in.</p>" },
          { roles: ALL, q: "How do I change my own password?",
            a: "<p><strong>Password</strong>, at the top right beside Sign out. You stay signed in after changing it.</p>" },
          { roles: ADMIN, q: "Someone has left. What do I do?",
            a: "<p>Deactivate their membership from Team, or revoke their portal access from Portal. Deactivating keeps their history intact while removing access immediately.</p>" },
          { roles: ALL, q: "What can clients and closers actually see?",
            a: "<p>A client sees only their own company's data. A closer sees only their own placement — not teammates, not other clients. Enforced by the database on every request, not by the interface.</p>" }
        ]
      }
    ]
  };
})(window);
