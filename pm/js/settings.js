// Settings: team member management (add, activate/deactivate, guarded delete).

(() => {
  const tableHost = document.getElementById("members-table");
  const form = document.getElementById("add-member-form");
  let members = [];
  let deleteArmedFor = null;

  async function load() {
    try {
      members = await API.getMembers();
      render();
    } catch (e) {
      tableHost.innerHTML = "";
      UI.toast(e.message);
    }
  }

  function render() {
    if (members.length === 0) {
      tableHost.innerHTML = `<div class="empty-state"><p>No team members yet — add one above.</p></div>`;
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>Name</th><th>Role</th><th>Active</th><th style="width:130px;"></th></tr>
        </thead>
        <tbody>
          ${members
            .map(
              (m) => `
              <tr class="${m.active ? "" : "inactive-row"}" data-id="${m.id}">
                <td style="font-weight:600;">${UI.esc(m.name)}</td>
                <td>${UI.esc(m.role || "—")}</td>
                <td>
                  <label class="switch">
                    <input type="checkbox" data-toggle="${m.id}" ${m.active ? "checked" : ""}>
                    <span class="slider"></span>
                  </label>
                </td>
                <td style="text-align:right;">
                  <button class="btn btn-danger" data-delete="${m.id}" style="padding:5px 10px;font-size:13px;">
                    ${deleteArmedFor === m.id ? "Confirm delete" : "Delete"}
                  </button>
                </td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>`;

    tableHost.querySelectorAll("[data-toggle]").forEach((input) => {
      input.addEventListener("change", async () => {
        const id = input.dataset.toggle;
        const active = input.checked;
        try {
          const updated = await API.updateMember(id, { active });
          members = members.map((m) => (m.id === id ? updated : m));
          UI.toast(active ? "Member activated." : "Member deactivated — hidden from assignee dropdowns.", "success");
          render();
        } catch (e) {
          input.checked = !active;
          UI.toast(e.message);
        }
      });
    });

    tableHost.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.delete;
        const member = members.find((m) => m.id === id);
        try {
          if (deleteArmedFor !== id) {
            // Guard: members with task assignments cannot be deleted (PRD F-09)
            const hasTasks = await API.memberHasTasks(id);
            if (hasTasks) {
              UI.toast(`${member.name} has tasks assigned. Reassign those tasks first, or deactivate instead.`);
              return;
            }
            deleteArmedFor = id;
            btn.textContent = "Confirm delete";
            btn.classList.add("confirming");
            return;
          }
          await API.deleteMember(id);
          members = members.filter((m) => m.id !== id);
          deleteArmedFor = null;
          UI.toast("Member deleted.", "success");
          render();
        } catch (e) {
          UI.toast(e.message);
        }
      });
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    UI.clearFieldErrors(form);
    const nameInput = document.getElementById("m-name");
    const name = nameInput.value.trim();
    if (!name) {
      UI.fieldError(nameInput, "Name is required.");
      return;
    }
    if (members.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      UI.fieldError(nameInput, "A member with this name already exists.");
      return;
    }
    try {
      const created = await API.createMember({
        name,
        role: document.getElementById("m-role").value.trim() || null,
      });
      members.push(created);
      members.sort((a, b) => a.name.localeCompare(b.name));
      nameInput.value = "";
      document.getElementById("m-role").value = "";
      UI.toast("Member added.", "success");
      render();
    } catch (err) {
      UI.toast(err.message);
    }
  });

  load();
})();
