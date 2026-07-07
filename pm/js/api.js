// All Supabase data access for the VBOG PM Tool.
// Endpoints mirror PRD §7 (PostgREST auto-API).

const API = {
  // ---- projects ----
  getProjects() {
    return sbFetch("projects?select=*&order=created_at.asc");
  },
  getProject(id) {
    return sbFetch(`projects?id=eq.${id}&select=*`).then((r) => r[0] || null);
  },
  createProject(fields) {
    return sbFetch("projects", { method: "POST", body: fields }).then((r) => r[0]);
  },
  updateProject(id, fields) {
    return sbFetch(`projects?id=eq.${id}`, { method: "PATCH", body: fields }).then((r) => r[0]);
  },

  // ---- tasks ----
  getTasks(projectId) {
    return sbFetch(`tasks?project_id=eq.${projectId}&select=*`);
  },
  // Lightweight fetch for dashboard counts (all projects at once)
  getTaskSummaries() {
    return sbFetch("tasks?select=project_id,due_date");
  },
  getTasksForMember(memberId) {
    return sbFetch(
      `tasks?assignee_id=eq.${memberId}` +
        `&select=*,projects!inner(id,name,color,archived)&projects.archived=eq.false` +
        `&order=due_date.asc.nullslast,created_at.asc`
    );
  },
  createTask(fields) {
    return sbFetch("tasks", { method: "POST", body: fields }).then((r) => r[0]);
  },
  updateTask(id, fields) {
    return sbFetch(`tasks?id=eq.${id}`, { method: "PATCH", body: fields }).then((r) => r[0]);
  },
  deleteTask(id) {
    return sbFetch(`tasks?id=eq.${id}`, { method: "DELETE" });
  },
  memberHasTasks(memberId) {
    return sbFetch(`tasks?assignee_id=eq.${memberId}&select=id&limit=1`).then((r) => r.length > 0);
  },

  // ---- team members ----
  getMembers() {
    return sbFetch("team_members?select=*&order=name.asc");
  },
  createMember(fields) {
    return sbFetch("team_members", { method: "POST", body: fields }).then((r) => r[0]);
  },
  updateMember(id, fields) {
    return sbFetch(`team_members?id=eq.${id}`, { method: "PATCH", body: fields }).then((r) => r[0]);
  },
  deleteMember(id) {
    return sbFetch(`team_members?id=eq.${id}`, { method: "DELETE" });
  },
};
