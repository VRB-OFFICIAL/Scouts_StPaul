(function(){
  const COLLECTION = 'troopTracker';
  const DOC_ID = 'data';

  // ---------- LOGIN / ROLE ----------
  // Two access codes gate the app: entering the editor code unlocks full
  // editing, entering the viewer code unlocks read-only viewing (people can
  // still browse groups, attendance, points, tests and open member files —
  // they just can't change anything, including roles). Change these two
  // codes to whatever you like before sharing the app with your troop.
  //
  // NOTE ON SECURITY: this check happens in the browser, so it keeps
  // honest people honest and stops casual/accidental edits — it is not a
  // substitute for real server-side authentication. Anyone who really
  // wanted to could read this file and find the codes, or connect to
  // Firestore directly. For a troop tracker that's normally an acceptable
  // trade-off, but don't use this pattern for anything sensitive.
  const EDITOR_CODE = 'troop-editor';
  const VIEWER_CODE = 'troop-viewer';
  const ROLE_KEY = 'troopTrackerRole';

  let currentRole = null; // 'editor' | 'viewer' | null (not logged in yet)
  function isEditor(){ return currentRole === 'editor'; }

  function defaultData(){
    return {
      groups: [
        {id:'g1', name:'Group 1', members:[]},
        {id:'g2', name:'Group 2', members:[]},
        {id:'g3', name:'Group 3', members:[]},
        {id:'g4', name:'Group 4', members:[]}
      ],
      attendance: [], // {date, records: {memberId: 'present'|'late'|'absent'}}
      tests: [] // {id, name, date, maxScore, records: {memberId: {score, result:'pass'|'fail'|''}}}
    };
  }

  let data = defaultData();
  let docRef = null;
  let firstLoadHandled = false;

  function saveData(){
    if(!docRef){
      console.warn('Not connected yet — change was not saved.');
      return;
    }
    // Firestore documents can't store nested arrays directly, so the
    // whole data object is JSON-stringified into a single field.
    docRef.set({ json: JSON.stringify(data) }).catch(e=>{
      console.error('Could not save data', e);
      showStatus('Could not save — check your connection.', true);
    });
  }

  let uidCounter = Date.now();
  function uid(){ uidCounter += 1; return 'm' + uidCounter; }

  function migrateData(d){
    d.groups.forEach(g=>{
      g.members.forEach(m=>{
        if(typeof m.role !== 'string'){
          m.role = '';
        }
        if(!Array.isArray(m.pointLog)){
          m.pointLog = [];
          // Carry over any pre-existing plain point total as one dated entry,
          // so nobody's history/totals appear to reset when this ships.
          if(typeof m.points === 'number' && m.points !== 0){
            m.pointLog.push({
              id: uid(),
              date: new Date().toISOString().slice(0,10),
              amount: m.points,
              reason: 'Carried over from before point history was tracked'
            });
          }
        }
        delete m.points;
      });
    });
    if(!Array.isArray(d.tests)) d.tests = [];
    d.tests.forEach(t=>{
      if(!t.records || typeof t.records !== 'object') t.records = {};
      if(typeof t.maxScore !== 'number') t.maxScore = 10;
    });
    return d;
  }

  // A member's points now live entirely in m.pointLog — an array of
  // {id, date, amount, reason}. Gained/lost/net are always derived from it,
  // never stored separately, so they can never drift out of sync.
  function memberTotals(member){
    const log = Array.isArray(member.pointLog) ? member.pointLog : [];
    let gained = 0, lost = 0;
    log.forEach(e=>{
      if(e.amount > 0) gained += e.amount;
      else lost += -e.amount;
    });
    return { gained, lost, net: gained - lost };
  }

  // ---------- LOGIN SCREEN ----------
  const loginScreen = document.getElementById('loginScreen');
  const loginForm = document.getElementById('loginForm');
  const loginCodeInput = document.getElementById('loginCode');
  const loginError = document.getElementById('loginError');
  const roleBadge = document.getElementById('roleBadge');
  const logoutBtn = document.getElementById('logoutBtn');
  let appStarted = false; // guards against calling initFirebase() more than once

  function startApp(role){
    currentRole = role;
    document.body.classList.remove('not-authed');
    document.body.classList.toggle('viewer-mode', role === 'viewer');
    loginScreen.classList.remove('show');
    roleBadge.textContent = role === 'editor' ? 'Editor' : 'Viewer';
    roleBadge.className = 'role-badge ' + role;
    renderAll();
    if(!appStarted){
      appStarted = true;
      initFirebase();
    }
  }

  loginForm.addEventListener('submit', (e)=>{
    e.preventDefault();
    const code = loginCodeInput.value.trim();
    let role = null;
    if(code && code === EDITOR_CODE) role = 'editor';
    else if(code && code === VIEWER_CODE) role = 'viewer';
    if(!role){
      loginError.textContent = 'That code is not recognized — try again.';
      loginError.classList.add('show');
      loginCodeInput.select();
      return;
    }
    loginError.classList.remove('show');
    localStorage.setItem(ROLE_KEY, role);
    loginCodeInput.value = '';
    startApp(role);
  });

  logoutBtn.addEventListener('click', ()=>{
    localStorage.removeItem(ROLE_KEY);
    location.reload();
  });

  // ---------- STATUS BANNER ----------
  function showStatus(msg, isError){
    const el = document.getElementById('connectionStatus');
    if(!el) return;
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    if(!isError){
      setTimeout(()=>el.classList.remove('show'), 2500);
    }
  }
  function hideStatus(){
    const el = document.getElementById('connectionStatus');
    if(el) el.classList.remove('show');
  }

  // ---------- FIREBASE INIT ----------
  function initFirebase(){
    if(typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length){
      showStatus('Firebase is not configured yet. Fill in firebase-config.js.', true);
      renderAll();
      return;
    }

    showStatus('Connecting…', false);

    firebase.auth().onAuthStateChanged(user=>{
      if(!user) return;
      docRef = firebase.firestore().collection(COLLECTION).doc(DOC_ID);
      docRef.onSnapshot(snapshot=>{
        const snap = snapshot.data();
        let parsed = null;
        if(snap && typeof snap.json === 'string'){
          try{ parsed = JSON.parse(snap.json); }
          catch(e){ console.error('Could not parse stored data', e); }
        }
        if(parsed && Array.isArray(parsed.groups) && parsed.groups.length){
          data = migrateData(parsed);
          if(!Array.isArray(data.attendance)) data.attendance = [];
          if(!Array.isArray(data.tests)) data.tests = [];
        } else if(!firstLoadHandled){
          // Nothing in the database yet — seed it with the defaults.
          data = defaultData();
          saveData();
        }
        firstLoadHandled = true;
        hideStatus();
        renderAll();
      }, err=>{
        console.error('Database read failed', err);
        showStatus('Database error: ' + (err.code || err.message || err), true);
      });
    });

    firebase.auth().signInAnonymously().catch(e=>{
      console.error('Auth failed', e);
      showStatus('Sign-in error: ' + (e.code || e.message || e), true);
    });
  }

  function renderAll(){
    renderGroups();
    const activeBtn = document.querySelector('nav button.active');
    const activeView = activeBtn ? activeBtn.dataset.view : 'groups';
    if(activeView === 'attendance') renderAttendanceView();
    if(activeView === 'points') renderPointsView();
    if(activeView === 'breakdown') renderBreakdownView();
    if(activeView === 'tests') renderTestsView();
  }

  // ---------- NAV ----------
  const navButtons = document.querySelectorAll('nav button');
  navButtons.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      navButtons.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
      if(btn.dataset.view === 'attendance') renderAttendanceView();
      if(btn.dataset.view === 'points') renderPointsView();
      if(btn.dataset.view === 'breakdown') renderBreakdownView();
      if(btn.dataset.view === 'tests') renderTestsView();
    });
  });

  // ---------- GROUPS VIEW ----------
  function renderGroups(){
    const grid = document.getElementById('groupsGrid');
    grid.innerHTML = '';
    data.groups.forEach(group=>{
      const total = group.members.reduce((s,m)=>s+memberTotals(m).net,0);
      const card = document.createElement('div');
      card.className = 'crest';
      card.innerHTML = `
        <div class="crest-header">
          <div class="crest-badge">${group.members.length}</div>
          <input class="crest-name-input" value="${escapeAttr(group.name)}" data-group="${group.id}" ${isEditor() ? '' : 'readonly'}>
          <div class="crest-points">Total points: <strong>${total}</strong></div>
        </div>
        <div class="crest-body">
          <ul class="member-list">
            ${group.members.length ? group.members.map(m=>`
              <li>
                <span class="member-name-role">
                  <span class="member-name">${escapeHtml(m.name)}</span>
                  ${m.role ? `<span class="member-role" style="font-size:${roleFontSize(m.role)}">${escapeHtml(m.role)}</span>` : ''}
                </span>
                <span class="member-actions">
                  <span class="member-points">${memberTotals(m).net}</span>
                  <button class="icon-btn file-btn" data-member-file="${m.id}" title="Open ${escapeAttr(m.name)}'s file">📇</button>
                  ${isEditor() ? `<button class="icon-btn role-edit-btn" data-edit-role="${m.id}" title="Set role">✎</button>` : ''}
                  ${isEditor() ? `<button class="icon-btn remove-member-btn" data-remove-member="${group.id}|${m.id}" title="Remove person">✕</button>` : ''}
                </span>
              </li>
            `).join('') : '<li class="empty-msg">No one added yet</li>'}
          </ul>
          ${isEditor() ? `
          <div class="add-member-row">
            <input type="text" placeholder="Add a person's name" data-add-input="${group.id}">
            <button data-add-btn="${group.id}">Add</button>
          </div>` : ''}
        </div>
      `;
      grid.appendChild(card);
    });

    // wire up group name edits
    grid.querySelectorAll('.crest-name-input').forEach(inp=>{
      inp.addEventListener('change', ()=>{
        if(!isEditor()) return;
        const g = data.groups.find(g=>g.id===inp.dataset.group);
        if(g){ g.name = inp.value.trim() || g.name; saveData(); renderGroups(); }
      });
    });

    // wire up member file buttons
    grid.querySelectorAll('[data-member-file]').forEach(btn=>{
      btn.addEventListener('click', ()=> openMemberFile(btn.dataset.memberFile));
    });

    // wire up member role edits
    grid.querySelectorAll('[data-edit-role]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(!isEditor()) return;
        const m = findMemberById(btn.dataset.editRole);
        if(!m) return;
        const newRole = prompt('Role (e.g. Leader, 2nd in Command, 1st Year):', m.role || '');
        if(newRole === null) return;
        m.role = newRole.trim();
        saveData();
        renderGroups();
      });
    });

    // add member buttons
    grid.querySelectorAll('[data-add-btn]').forEach(btn=>{
      const groupId = btn.dataset.addBtn;
      const input = grid.querySelector(`[data-add-input="${groupId}"]`);
      const addFn = ()=>{
        if(!isEditor()) return;
        const name = input.value.trim();
        if(!name) return;
        const g = data.groups.find(g=>g.id===groupId);
        g.members.push({id:uid(), name, role:'', pointLog:[]});
        saveData();
        renderGroups();
      };
      btn.addEventListener('click', addFn);
      input.addEventListener('keydown', e=>{ if(e.key==='Enter') addFn(); });
    });

    // remove member buttons
    grid.querySelectorAll('[data-remove-member]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(!isEditor()) return;
        const [groupId, memberId] = btn.dataset.removeMember.split('|');
        const g = data.groups.find(g=>g.id===groupId);
        g.members = g.members.filter(m=>m.id!==memberId);
        saveData();
        renderGroups();
      });
    });
  }

  // ---------- ATTENDANCE VIEW ----------
  const attendanceDateInput = document.getElementById('attendanceDate');
  attendanceDateInput.valueAsDate = new Date();
  const attendanceMaxPointsInput = document.getElementById('attendanceMaxPoints');

  let currentAttendanceSelections = {}; // memberId -> {status, excused, lateValue, lateUnit, uniform, tools}, for the date being edited
  let loadedAttendanceDate = null; // which date's saved records are currently loaded into currentAttendanceSelections
  let currentMaxPoints = 10; // max points for uniform & tools, shared, set per meeting

  // A record may be stored either as a plain string (older saves, before
  // this feature existed) or as an object with extra detail. This always
  // returns the object form so the rest of the code has one shape to deal with.
  function normalizeRecord(record){
    if(!record) return {status:''};
    if(typeof record === 'string') return {status: record};
    return record;
  }

  function loadSelectionsForDate(dateStr){
    const existing = data.attendance.find(a=>a.date===dateStr);
    const selections = {};
    if(existing){
      Object.entries(existing.records).forEach(([memberId, record])=>{
        selections[memberId] = {...normalizeRecord(record)};
      });
    }
    return selections;
  }

  function loadMaxPointsForDate(dateStr){
    const existing = data.attendance.find(a=>a.date===dateStr);
    if(existing && typeof existing.maxPoints === 'number') return existing.maxPoints;
    return 10;
  }

  // Compact "Present" / "Late · 15 Mins" / "Absent · Excused" summary text
  // shown next to each name, live, as selections are made.
  function statusSummaryText(sel){
    if(!sel || !sel.status) return '';
    if(sel.status === 'present') return 'Present';
    if(sel.status === 'late'){
      if(sel.lateValue){
        const unit = sel.lateUnit === 'hours' ? 'Hrs' : 'Mins';
        return `Late · ${sel.lateValue} ${unit}`;
      }
      return 'Late';
    }
    if(sel.status === 'absent'){
      if(sel.excused === true) return 'Absent · Excused';
      if(sel.excused === false) return 'Absent · Unexcused';
      return 'Absent';
    }
    return '';
  }

  function renderAttendanceView(){
    const wrap = document.getElementById('attendanceGroups');
    const dateStr = attendanceDateInput.value;

    // Only pull fresh from saved data when we've switched to a different
    // date. Re-rendering after a button click (same date) must NOT touch
    // currentAttendanceSelections, or every click would immediately erase
    // itself before it ever showed as selected.
    if(loadedAttendanceDate !== dateStr){
      currentAttendanceSelections = loadSelectionsForDate(dateStr);
      currentMaxPoints = loadMaxPointsForDate(dateStr);
      attendanceMaxPointsInput.value = currentMaxPoints;
      loadedAttendanceDate = dateStr;
    }

    wrap.innerHTML = '';

    data.groups.forEach(group=>{
      const div = document.createElement('div');
      div.className = 'attendance-group';
      div.innerHTML = `
        <h3>${escapeHtml(group.name)}</h3>
        ${group.members.length ? group.members.map(m=>{
          const sel = normalizeRecord(currentAttendanceSelections[m.id]);
          const status = sel.status || '';
          const excused = sel.excused;
          const lateValue = sel.lateValue || '';
          const lateUnit = sel.lateUnit || 'minutes';
          const summary = statusSummaryText(sel);
          const uniformVal = sel.uniform === undefined || sel.uniform === null ? '' : sel.uniform;
          const toolsVal = sel.tools === undefined || sel.tools === null ? '' : sel.tools;
          const [uniformLabel, toolsLabel, overallLabel] = formatUniformToolsLabels(sel, currentMaxPoints);
          return `
          <div class="attendance-row-group">
            <div class="attendance-row">
              <span class="a-name">${escapeHtml(m.name)}${summary ? ` <span class="a-summary ${status}">· ${escapeHtml(summary)}</span>` : ''}</span>
              ${isEditor() ? `
              <div class="uniform-tools-inputs">
                <label class="ut-label">Uniform <input type="number" min="0" max="${currentMaxPoints}" class="ut-input" data-member="${m.id}" data-kind="uniform" value="${escapeAttr(uniformVal)}" placeholder="/${currentMaxPoints}"></label>
                <label class="ut-label">Tools <input type="number" min="0" max="${currentMaxPoints}" class="ut-input" data-member="${m.id}" data-kind="tools" value="${escapeAttr(toolsVal)}" placeholder="/${currentMaxPoints}"></label>
              </div>
              <div class="status-btns">
                <button class="status-btn present ${status==='present'?'selected':''}" data-member="${m.id}" data-status="present">Present</button>
                <button class="status-btn late ${status==='late'?'selected':''}" data-member="${m.id}" data-status="late">Late</button>
                <button class="status-btn absent ${status==='absent'?'selected':''}" data-member="${m.id}" data-status="absent">Absent</button>
              </div>` : `
              <div class="ut-readonly">${escapeHtml(uniformLabel)} · ${escapeHtml(toolsLabel)} · ${escapeHtml(overallLabel)}</div>`}
            </div>
            ${isEditor() ? `
            <div class="detail-row absent-detail ${status==='absent'?'show':''}" data-member="${m.id}">
              <span class="detail-label">Reason:</span>
              <div class="sub-btns">
                <button class="sub-btn excused ${excused===true?'selected':''}" data-member="${m.id}" data-excused="true">With excuse</button>
                <button class="sub-btn unexcused ${excused===false?'selected':''}" data-member="${m.id}" data-excused="false">Without excuse</button>
              </div>
            </div>
            <div class="detail-row late-detail ${status==='late'?'show':''}" data-member="${m.id}">
              <span class="detail-label">Late by:</span>
              <input type="number" min="0" class="late-amount" data-member="${m.id}" value="${escapeAttr(lateValue)}" placeholder="e.g. 15">
              <div class="unit-btns">
                <button class="unit-btn ${lateUnit==='minutes'?'selected':''}" data-member="${m.id}" data-unit="minutes">Minutes</button>
                <button class="unit-btn ${lateUnit==='hours'?'selected':''}" data-member="${m.id}" data-unit="hours">Hours</button>
              </div>
            </div>` : ''}
          </div>`;
        }).join('') : '<div class="empty-msg">No one in this group yet — add people in the Groups tab.</div>'}
      `;
      wrap.appendChild(div);
    });

    wrap.querySelectorAll('.status-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(!isEditor()) return;
        const memberId = btn.dataset.member;
        const status = btn.dataset.status;
        const existingSel = normalizeRecord(currentAttendanceSelections[memberId]);
        const sel = { status };
        if(status === 'absent' && existingSel.status === 'absent') sel.excused = existingSel.excused;
        if(status === 'late' && existingSel.status === 'late'){
          sel.lateValue = existingSel.lateValue;
          sel.lateUnit = existingSel.lateUnit || 'minutes';
        }
        if(status === 'late' && !sel.lateUnit) sel.lateUnit = 'minutes';
        currentAttendanceSelections[memberId] = sel;
        renderAttendanceView();
      });
    });

    wrap.querySelectorAll('.sub-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(!isEditor()) return;
        const memberId = btn.dataset.member;
        const sel = normalizeRecord(currentAttendanceSelections[memberId]);
        sel.status = 'absent';
        sel.excused = btn.dataset.excused === 'true';
        currentAttendanceSelections[memberId] = sel;
        renderAttendanceView();
      });
    });

    wrap.querySelectorAll('.unit-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(!isEditor()) return;
        const memberId = btn.dataset.member;
        const sel = normalizeRecord(currentAttendanceSelections[memberId]);
        sel.status = 'late';
        sel.lateUnit = btn.dataset.unit;
        currentAttendanceSelections[memberId] = sel;
        renderAttendanceView();
      });
    });

    wrap.querySelectorAll('.late-amount').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        if(!isEditor()) return;
        const memberId = inp.dataset.member;
        const sel = normalizeRecord(currentAttendanceSelections[memberId]);
        sel.status = 'late';
        sel.lateValue = inp.value;
        if(!sel.lateUnit) sel.lateUnit = 'minutes';
        currentAttendanceSelections[memberId] = sel;
        // Update just this row's summary text directly (no full re-render,
        // so the input keeps focus while the person is still typing).
        const row = inp.closest('.attendance-row-group').querySelector('.attendance-row');
        let summaryEl = row.querySelector('.a-summary');
        const summaryText = statusSummaryText(sel);
        if(summaryText){
          if(!summaryEl){
            summaryEl = document.createElement('span');
            row.querySelector('.a-name').appendChild(document.createTextNode(' '));
            row.querySelector('.a-name').appendChild(summaryEl);
          }
          summaryEl.className = 'a-summary late';
          summaryEl.textContent = '· ' + summaryText;
        }
      });
    });

    wrap.querySelectorAll('.ut-input').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        if(!isEditor()) return;
        const memberId = inp.dataset.member;
        const kind = inp.dataset.kind; // 'uniform' or 'tools'
        const sel = normalizeRecord(currentAttendanceSelections[memberId]);
        if(!sel.status) sel.status = '';
        let val = inp.value === '' ? null : parseInt(inp.value, 10);
        if(val !== null){
          if(isNaN(val)) val = null;
          else {
            if(val < 0) val = 0;
            if(val > currentMaxPoints) val = currentMaxPoints;
          }
        }
        sel[kind] = val;
        currentAttendanceSelections[memberId] = sel;
      });
      inp.addEventListener('change', ()=>{
        if(!isEditor()) return;
        // Reflect any clamping (e.g. typed value above max) back into the field
        const memberId = inp.dataset.member;
        const kind = inp.dataset.kind;
        const sel = normalizeRecord(currentAttendanceSelections[memberId]);
        const val = sel[kind];
        inp.value = (val === undefined || val === null) ? '' : val;
      });
    });

    renderHistory();
  }

  // ---------- DELETE ALL PAST MEETINGS ----------
  // Two-step "arm" so it can't be triggered by an accidental click:
  // 1) tap the lock icon and confirm twice to arm the red button
  // 2) tap the red button and confirm twice to actually delete
  // Locked meetings are never touched by this — unlock them individually
  // (or bulk-unlock, if you add that later) if you want them gone too.
  const armDeleteAllBtn = document.getElementById('armDeleteAllBtn');
  const deleteAllPastBtn = document.getElementById('deleteAllPastBtn');
  let deleteAllArmed = false;

  function setDeleteAllArmed(armed){
    deleteAllArmed = armed;
    deleteAllPastBtn.disabled = !armed;
    armDeleteAllBtn.textContent = armed ? '🔓' : '🔒';
    armDeleteAllBtn.classList.toggle('armed', armed);
    armDeleteAllBtn.title = armed
      ? 'Armed — click again to disarm, or use "Delete all past meetings" below'
      : 'Enable the delete-all button (requires confirming twice)';
  }
  setDeleteAllArmed(false);

  armDeleteAllBtn.addEventListener('click', ()=>{
    if(!isEditor()) return;
    if(deleteAllArmed){
      setDeleteAllArmed(false);
      return;
    }
    if(!confirm('This will enable a button that deletes every UNLOCKED past meeting at once. Locked meetings are always kept. Continue?')) return;
    if(!confirm('Are you sure? This step only arms the button — nothing is deleted yet.')) return;
    setDeleteAllArmed(true);
  });

  deleteAllPastBtn.addEventListener('click', ()=>{
    if(!isEditor()) return;
    if(!deleteAllArmed) return;
    const unlockedCount = data.attendance.filter(a=>!a.locked).length;
    if(unlockedCount === 0){
      alert('No unlocked meetings to delete — locked meetings are never removed by this button.');
      setDeleteAllArmed(false);
      return;
    }
    if(!confirm(`Delete all ${unlockedCount} unlocked past meeting(s)? Locked meetings will be kept. This can't be undone.`)) return;
    if(!confirm('Final check — really delete them all now?')) return;
    data.attendance = data.attendance.filter(a=>a.locked);
    saveData();
    setDeleteAllArmed(false);
    renderHistory();
  });

  attendanceMaxPointsInput.addEventListener('change', ()=>{
    if(!isEditor()) return;
    let val = parseInt(attendanceMaxPointsInput.value, 10);
    if(isNaN(val) || val < 0) val = 10;
    currentMaxPoints = val;
    attendanceMaxPointsInput.value = val;
    // Re-clamp any already-entered uniform/tools values to the new max.
    Object.values(currentAttendanceSelections).forEach(sel=>{
      if(typeof sel.uniform === 'number' && sel.uniform > val) sel.uniform = val;
      if(typeof sel.tools === 'number' && sel.tools > val) sel.tools = val;
    });
    renderAttendanceView();
  });

  document.getElementById('saveAttendanceBtn').addEventListener('click', ()=>{
    if(!isEditor()) return;
    const dateStr = attendanceDateInput.value;
    if(!dateStr) return;
    const existingIdx = data.attendance.findIndex(a=>a.date===dateStr);
    if(existingIdx>-1 && data.attendance[existingIdx].locked){
      alert('This meeting is locked. Unlock it in "Past meetings" before making changes.');
      return;
    }
    const record = {date: dateStr, records: {...currentAttendanceSelections}, maxPoints: currentMaxPoints};
    if(existingIdx>-1) data.attendance[existingIdx] = record;
    else data.attendance.push(record);
    data.attendance.sort((a,b)=> a.date < b.date ? 1 : -1);
    saveData();
    const msg = document.getElementById('attendanceSavedMsg');
    msg.classList.add('show');
    setTimeout(()=>msg.classList.remove('show'), 1800);
    renderHistory();
  });

  attendanceDateInput.addEventListener('change', renderAttendanceView);

  function findMemberName(memberId){
    for(const g of data.groups){
      const m = g.members.find(m=>m.id===memberId);
      if(m) return m.name;
    }
    return 'Unknown';
  }

  function formatRecordLabel(name, record){
    const sel = normalizeRecord(record);
    if(sel.status === 'absent'){
      const excuseLabel = sel.excused === true ? 'excused' : sel.excused === false ? 'unexcused' : '';
      return excuseLabel ? `${name} · ${excuseLabel}` : name;
    }
    if(sel.status === 'late' && sel.lateValue){
      const unit = sel.lateUnit || 'minutes';
      const unitLabel = unit === 'hours' ? 'hr' : 'min';
      return `${name} · ${sel.lateValue}${unitLabel}`;
    }
    return name;
  }

  // Uniform/tools are always shown next to the name in Past meetings —
  // if a value was never set for that member at that meeting, it's
  // displayed as 0 rather than being left out. "Overall" is the sum of
  // the two, shown as a fraction out of the combined max (maxPoints*2),
  // so it moves automatically whenever either changes.
  function formatUniformToolsLabels(record, maxPoints){
    const sel = normalizeRecord(record);
    const uniformVal = typeof sel.uniform === 'number' ? sel.uniform : 0;
    const toolsVal = typeof sel.tools === 'number' ? sel.tools : 0;
    const overallVal = uniformVal + toolsVal;
    const overallMax = maxPoints * 2;
    return [
      `uniform · ${uniformVal}/${maxPoints}`,
      `tools · ${toolsVal}/${maxPoints}`,
      `overall · ${overallVal}/${overallMax}`
    ];
  }

  function renderHistory(){
    const list = document.getElementById('historyList');
    if(data.attendance.length===0){
      list.innerHTML = '<p class="empty-msg">No meetings recorded yet.</p>';
      return;
    }
    list.innerHTML = data.attendance.map(entry=>{
      const locked = !!entry.locked;
      const maxPoints = typeof entry.maxPoints === 'number' ? entry.maxPoints : 10;
      const tags = Object.entries(entry.records).map(([memberId,record])=>{
        const sel = normalizeRecord(record);
        const label = formatRecordLabel(findMemberName(memberId), record);
        const [uniformLabel, toolsLabel, overallLabel] = formatUniformToolsLabels(record, maxPoints);
        const removeBtn = (locked || !isEditor()) ? '' : `<button class="tag-remove" data-remove-date="${entry.date}" data-remove-member="${memberId}" title="Remove ${escapeAttr(findMemberName(memberId))} from this meeting">✕</button>`;
        const mainTag = `<span class="tag ${sel.status}">${escapeHtml(label)} <span class="tag-ut-inline">· ${escapeHtml(uniformLabel)} · ${escapeHtml(toolsLabel)} · ${escapeHtml(overallLabel)}</span>${removeBtn}</span>`;
        return mainTag;
      }).join('');
      return `
      <div class="history-entry ${locked?'locked':''}">
        <div class="history-entry-header">
          <span class="h-date">${entry.date}${locked ? ' <span class="lock-label">Locked</span>' : ''} <span class="h-max-points">Max: ${maxPoints}</span></span>
          ${isEditor() ? `
          <div class="history-entry-actions">
            <button class="icon-btn lock-btn" data-lock-date="${entry.date}" title="${locked?'Unlock this meeting':'Lock this meeting'}">${locked?'🔒':'🔓'}</button>
            <button class="icon-btn delete-btn" data-delete-date="${entry.date}" title="${locked?'Locked — unlock to delete':'Delete this meeting'}" ${locked?'disabled':''}>✕</button>
          </div>` : ''}
        </div>
        <div class="history-tags">${tags || '<span class="empty-msg">No records</span>'}</div>
      </div>`;
    }).join('');

    list.querySelectorAll('.lock-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(!isEditor()) return;
        const date = btn.dataset.lockDate;
        const entry = data.attendance.find(a=>a.date===date);
        if(!entry) return;
        entry.locked = !entry.locked;
        saveData();
        renderHistory();
      });
    });

    list.querySelectorAll('.delete-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(!isEditor()) return;
        const date = btn.dataset.deleteDate;
        const entry = data.attendance.find(a=>a.date===date);
        if(!entry || entry.locked) return; // locked meetings can't be deleted
        if(!confirm(`Delete the attendance record for ${date}? This can't be undone.`)) return;
        data.attendance = data.attendance.filter(a=>a.date!==date);
        saveData();
        renderHistory();
      });
    });

    list.querySelectorAll('.tag-remove').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        if(!isEditor()) return;
        e.stopPropagation();
        const date = btn.dataset.removeDate;
        const memberId = btn.dataset.removeMember;
        const entry = data.attendance.find(a=>a.date===date);
        if(!entry || entry.locked) return; // locked meetings can't be edited
        const name = findMemberName(memberId);
        if(!confirm(`Remove ${name} from the ${date} meeting record?`)) return;
        delete entry.records[memberId];
        saveData();
        renderHistory();
      });
    });
  }

  // ---------- POINTS VIEW ----------
  const pointsGroupSelect = document.getElementById('pointsGroupSelect');
  const pointsMemberSelect = document.getElementById('pointsMemberSelect');

  function renderPointsView(){
    pointsGroupSelect.innerHTML = data.groups.map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
    populateMemberSelect();
    renderLeaderboard();
  }

  function populateMemberSelect(){
    const g = data.groups.find(g=>g.id===pointsGroupSelect.value) || data.groups[0];
    pointsMemberSelect.innerHTML = g.members.length
      ? g.members.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')
      : '<option value="">No one in this group</option>';
  }
  pointsGroupSelect.addEventListener('change', populateMemberSelect);

  document.getElementById('addPointsBtn').addEventListener('click', ()=>{
    if(!isEditor()) return;
    const g = data.groups.find(g=>g.id===pointsGroupSelect.value);
    const memberId = pointsMemberSelect.value;
    const amount = parseInt(document.getElementById('pointsAmount').value, 10) || 0;
    const reasonInput = document.getElementById('pointsReason');
    const reason = reasonInput ? reasonInput.value.trim() : '';
    if(!g || !memberId || amount===0) return;
    const m = g.members.find(m=>m.id===memberId);
    if(!Array.isArray(m.pointLog)) m.pointLog = [];
    m.pointLog.push({
      id: uid(),
      date: new Date().toISOString().slice(0,10),
      amount,
      reason: reason || (amount>0 ? 'Points added' : 'Points deducted')
    });
    saveData();
    document.getElementById('pointsAmount').value = 1;
    if(reasonInput) reasonInput.value = '';
    renderLeaderboard();
    renderGroups();
  });

  function renderLeaderboard(){
    const board = document.getElementById('leaderboard');
    board.innerHTML = data.groups.map(g=>{
      const total = g.members.reduce((s,m)=>s+memberTotals(m).net,0);
      const sorted = [...g.members].sort((a,b)=>memberTotals(b).net-memberTotals(a).net);
      return `
        <div class="lb-group">
          <h3>${escapeHtml(g.name)} <span class="lb-total">${total} pts</span></h3>
          ${sorted.length ? sorted.map((m,i)=>`
            <div class="lb-row"><span><span class="rank">${i+1}.</span>${escapeHtml(m.name)}</span><span>${memberTotals(m).net}</span></div>
          `).join('') : '<p class="empty-msg">No one added yet</p>'}
        </div>
      `;
    }).join('');
  }

  // ---------- GROUPS BREAKDOWN VIEW ----------
  let expandedMemberId = null; // which member's log is currently expanded, if any

  function renderBreakdownView(){
    const wrap = document.getElementById('breakdownGroups');
    wrap.innerHTML = data.groups.map(g=>{
      const memberRows = g.members.map(m=>{
        const t = memberTotals(m);
        const isOpen = expandedMemberId === m.id;
        const log = [...(m.pointLog||[])].sort((a,b)=> a.date < b.date ? 1 : -1);
        return `
          <div class="bd-member">
            <button class="bd-member-row" data-toggle-member="${m.id}">
              <span class="bd-name">${escapeHtml(m.name)} <span class="bd-caret">${isOpen?'▾':'▸'}</span></span>
              <span class="bd-stats">
                <span class="bd-stat gained">+${t.gained}</span>
                <span class="bd-stat lost">-${t.lost}</span>
                <span class="bd-stat net">${t.net}</span>
              </span>
            </button>
            <div class="bd-log ${isOpen?'show':''}">
              ${log.length ? log.map(e=>`
                <div class="bd-log-entry">
                  <span class="bd-log-date">${e.date}</span>
                  <span class="bd-log-reason">${escapeHtml(e.reason||'')}</span>
                  <span class="bd-log-amount ${e.amount>0?'gained':'lost'}">${e.amount>0?'+':''}${e.amount}</span>
                  ${isEditor() ? `
                  <button class="icon-btn bd-edit" data-edit-entry="${m.id}|${e.id}" title="Edit">✎</button>
                  <button class="icon-btn bd-delete" data-delete-entry="${m.id}|${e.id}" title="Delete">✕</button>` : ''}
                </div>
              `).join('') : '<p class="empty-msg">No point history yet</p>'}
              ${isEditor() ? `
              <div class="bd-add-row">
                <input type="date" class="bd-add-date" data-member="${m.id}" value="${new Date().toISOString().slice(0,10)}">
                <input type="number" class="bd-add-amount" data-member="${m.id}" placeholder="+/- amount">
                <input type="text" class="bd-add-reason" data-member="${m.id}" placeholder="Reason">
                <button class="bd-add-btn" data-add-entry="${m.id}">Add</button>
              </div>` : ''}
            </div>
          </div>
        `;
      }).join('');

      const groupTotals = g.members.reduce((acc,m)=>{
        const t = memberTotals(m);
        acc.gained += t.gained; acc.lost += t.lost; acc.net += t.net;
        return acc;
      }, {gained:0, lost:0, net:0});

      return `
        <div class="bd-group">
          <div class="bd-group-header">
            <h3>${escapeHtml(g.name)}</h3>
            <span class="bd-stats">
              <span class="bd-stat gained">+${groupTotals.gained}</span>
              <span class="bd-stat lost">-${groupTotals.lost}</span>
              <span class="bd-stat net">${groupTotals.net}</span>
            </span>
          </div>
          ${g.members.length ? memberRows : '<p class="empty-msg">No one added yet</p>'}
        </div>
      `;
    }).join('');

    wrap.querySelectorAll('[data-toggle-member]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.dataset.toggleMember;
        expandedMemberId = expandedMemberId === id ? null : id;
        renderBreakdownView();
      });
    });

    wrap.querySelectorAll('[data-add-entry]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(!isEditor()) return;
        const memberId = btn.dataset.addEntry;
        const member = findMemberById(memberId);
        if(!member) return;
        const dateEl = wrap.querySelector(`.bd-add-date[data-member="${memberId}"]`);
        const amountEl = wrap.querySelector(`.bd-add-amount[data-member="${memberId}"]`);
        const reasonEl = wrap.querySelector(`.bd-add-reason[data-member="${memberId}"]`);
        const amount = parseInt(amountEl.value, 10) || 0;
        if(amount === 0) return;
        if(!Array.isArray(member.pointLog)) member.pointLog = [];
        member.pointLog.push({
          id: uid(),
          date: dateEl.value || new Date().toISOString().slice(0,10),
          amount,
          reason: reasonEl.value.trim() || (amount>0 ? 'Points added' : 'Points deducted')
        });
        saveData();
        renderGroups();
        renderBreakdownView();
      });
    });

    wrap.querySelectorAll('[data-edit-entry]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(!isEditor()) return;
        const [memberId, entryId] = btn.dataset.editEntry.split('|');
        const member = findMemberById(memberId);
        const entry = member && member.pointLog.find(e=>e.id===entryId);
        if(!entry) return;
        const newAmount = prompt('Amount (use a minus sign for a deduction):', entry.amount);
        if(newAmount === null) return;
        const parsed = parseInt(newAmount, 10);
        if(isNaN(parsed) || parsed === 0) return;
        const newReason = prompt('Reason:', entry.reason || '');
        if(newReason === null) return;
        const newDate = prompt('Date (YYYY-MM-DD):', entry.date);
        if(newDate === null) return;
        entry.amount = parsed;
        entry.reason = newReason.trim();
        entry.date = newDate.trim() || entry.date;
        saveData();
        renderGroups();
        renderBreakdownView();
      });
    });

    wrap.querySelectorAll('[data-delete-entry]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(!isEditor()) return;
        const [memberId, entryId] = btn.dataset.deleteEntry.split('|');
        const member = findMemberById(memberId);
        if(!member) return;
        if(!confirm('Delete this point log entry?')) return;
        member.pointLog = member.pointLog.filter(e=>e.id!==entryId);
        saveData();
        renderGroups();
        renderBreakdownView();
      });
    });
  }

  // ---------- TESTS VIEW ----------
  const testNameInput = document.getElementById('testName');
  const testDateInput = document.getElementById('testDate');
  const testMaxScoreInput = document.getElementById('testMaxScore');
  testDateInput.valueAsDate = new Date();

  document.getElementById('addTestBtn').addEventListener('click', ()=>{
    if(!isEditor()) return;
    const name = testNameInput.value.trim();
    if(!name) return;
    const date = testDateInput.value || new Date().toISOString().slice(0,10);
    let maxScore = parseInt(testMaxScoreInput.value, 10);
    if(isNaN(maxScore) || maxScore < 0) maxScore = 10;
    data.tests.push({ id: uid(), name, date, maxScore, records: {} });
    data.tests.sort((a,b)=> a.date < b.date ? 1 : -1);
    saveData();
    testNameInput.value = '';
    testDateInput.valueAsDate = new Date();
    testMaxScoreInput.value = 10;
    renderTestsView();
  });

  function testRecord(test, memberId){
    return test.records[memberId] || { score: null, result: '' };
  }

  function renderTestsView(){
    const wrap = document.getElementById('testsList');
    if(!data.tests.length){
      wrap.innerHTML = '<p class="empty-msg">No tests added yet.</p>';
      return;
    }
    wrap.innerHTML = data.tests.map(test=>{
      const groupBlocks = data.groups.map(g=>{
        if(!g.members.length) return '';
        const rows = g.members.map(m=>{
          const rec = testRecord(test, m.id);
          const scoreVal = (rec.score===null || rec.score===undefined) ? '' : rec.score;
          const controls = isEditor() ? `
                <input type="number" min="0" max="${test.maxScore}" class="test-score-input" data-test="${test.id}" data-member="${m.id}" value="${escapeAttr(scoreVal)}" placeholder="0">
                <span class="test-score-max">/ ${test.maxScore}</span>
                <div class="pf-btns">
                  <button class="pf-btn pass ${rec.result==='pass'?'selected':''}" data-test="${test.id}" data-member="${m.id}" data-result="pass">Pass</button>
                  <button class="pf-btn fail ${rec.result==='fail'?'selected':''}" data-test="${test.id}" data-member="${m.id}" data-result="fail">Fail</button>
                </div>` : `
                <span class="test-score-max">${scoreVal!=='' ? `${scoreVal} / ${test.maxScore}` : 'Not graded'}</span>
                ${rec.result ? `<span class="mf-test-tag ${rec.result}">${rec.result==='pass'?'Pass':'Fail'}</span>` : ''}`;
          return `
            <div class="test-row">
              <button class="test-name-btn" data-test-open-member="${m.id}" title="Open ${escapeAttr(m.name)}'s file">${escapeHtml(m.name)}</button>
              <div class="test-row-controls">${controls}</div>
            </div>
          `;
        }).join('');
        return `<div class="test-group-block"><h4>${escapeHtml(g.name)}</h4>${rows}</div>`;
      }).join('');

      return `
        <div class="test-card">
          <div class="test-card-header">
            <h3>${escapeHtml(test.name)}<span class="test-meta">${test.date}</span></h3>
            ${isEditor() ? `
            <div class="test-card-actions">
              <button class="test-delete-btn" data-delete-test="${test.id}" title="Delete this test">✕</button>
            </div>` : ''}
          </div>
          ${groupBlocks || '<p class="empty-msg">No one in any group yet.</p>'}
        </div>
      `;
    }).join('');

    wrap.querySelectorAll('[data-test-open-member]').forEach(btn=>{
      btn.addEventListener('click', ()=> openMemberFile(btn.dataset.testOpenMember));
    });

    wrap.querySelectorAll('.test-score-input').forEach(inp=>{
      inp.addEventListener('change', ()=>{
        if(!isEditor()) return;
        const test = data.tests.find(t=>t.id===inp.dataset.test);
        if(!test) return;
        const memberId = inp.dataset.member;
        const rec = testRecord(test, memberId);
        let val = inp.value === '' ? null : parseInt(inp.value, 10);
        if(val !== null){
          if(isNaN(val)) val = null;
          else {
            if(val < 0) val = 0;
            if(val > test.maxScore) val = test.maxScore;
          }
        }
        test.records[memberId] = { ...rec, score: val };
        inp.value = val === null ? '' : val;
        saveData();
      });
    });

    wrap.querySelectorAll('.pf-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(!isEditor()) return;
        const test = data.tests.find(t=>t.id===btn.dataset.test);
        if(!test) return;
        const memberId = btn.dataset.member;
        const rec = testRecord(test, memberId);
        const newResult = btn.dataset.result;
        rec.result = rec.result === newResult ? '' : newResult;
        test.records[memberId] = rec;
        saveData();
        renderTestsView();
      });
    });

    wrap.querySelectorAll('[data-delete-test]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(!isEditor()) return;
        const testId = btn.dataset.deleteTest;
        const test = data.tests.find(t=>t.id===testId);
        if(!test) return;
        if(!confirm(`Delete "${test.name}"? This can't be undone.`)) return;
        data.tests = data.tests.filter(t=>t.id!==testId);
        saveData();
        renderTestsView();
      });
    });
  }

  function findMemberById(memberId){
    for(const g of data.groups){
      const m = g.members.find(m=>m.id===memberId);
      if(m) return m;
    }
    return null;
  }

  // ---------- MEMBER FILE (slide-over panel with swipeable info cards) ----------
  let mfCurrentSlide = 0;

  function findGroupOfMember(memberId){
    return data.groups.find(g=>g.members.some(m=>m.id===memberId)) || null;
  }

  // Every past meeting that has a record for this member, most recent first.
  function attendanceRowsForMember(memberId){
    return data.attendance
      .filter(a=>a.records && a.records[memberId])
      .map(a=>({
        date: a.date,
        record: a.records[memberId],
        maxPoints: typeof a.maxPoints==='number' ? a.maxPoints : 10
      }))
      .sort((a,b)=> a.date < b.date ? 1 : -1);
  }

  // Every test where this member has been marked pass or fail — an empty
  // score/result means they haven't been graded on that test yet, so it's
  // not counted as "participated" and left out of their file.
  function testRowsForMember(memberId){
    return data.tests
      .filter(t=>t.records && t.records[memberId] && t.records[memberId].result)
      .map(t=>({
        name: t.name,
        date: t.date,
        score: t.records[memberId].score,
        maxScore: t.maxScore,
        result: t.records[memberId].result
      }))
      .sort((a,b)=> a.date < b.date ? 1 : -1);
  }

  function attendanceDetailText(sel){
    if(sel.status === 'absent'){
      if(sel.excused === true) return 'Excused';
      if(sel.excused === false) return 'Unexcused';
      return '';
    }
    if(sel.status === 'late' && sel.lateValue){
      const unit = sel.lateUnit === 'hours' ? 'hr' : 'min';
      return `${sel.lateValue}${unit}`;
    }
    return '';
  }

  function statusLabel(status){
    if(!status) return '—';
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  function initialsFor(name){
    return name.trim().split(/\s+/).slice(0,2).map(w=>w[0] ? w[0].toUpperCase() : '').join('');
  }

  function openMemberFile(memberId){
    const member = findMemberById(memberId);
    if(!member) return;
    const group = findGroupOfMember(memberId);
    const t = memberTotals(member);
    const attendanceRows = attendanceRowsForMember(memberId);
    const presentCount = attendanceRows.filter(r=>normalizeRecord(r.record).status==='present').length;
    const lateCount = attendanceRows.filter(r=>normalizeRecord(r.record).status==='late').length;
    const absentCount = attendanceRows.filter(r=>normalizeRecord(r.record).status==='absent').length;
    const log = [...(member.pointLog||[])].sort((a,b)=> a.date < b.date ? 1 : -1);
    const testRows = testRowsForMember(memberId);
    const passCount = testRows.filter(r=>r.result==='pass').length;
    const failCount = testRows.filter(r=>r.result==='fail').length;

    document.getElementById('mfName').textContent = member.name;

    const slidesEl = document.getElementById('mfSlides');
    slidesEl.innerHTML = `
      <div class="mf-slide">
        <h3 class="mf-slide-title">Overview</h3>
        <div class="mf-initials-circle">${escapeHtml(initialsFor(member.name))}</div>
        ${member.role ? `<div class="mf-role-tag">${escapeHtml(member.role)}</div>` : ''}
        <div class="mf-stat-grid">
          <div class="mf-stat-card"><span class="mf-stat-label">Group</span><span class="mf-stat-value">${group ? escapeHtml(group.name) : '—'}</span></div>
          <div class="mf-stat-card"><span class="mf-stat-label">Net points</span><span class="mf-stat-value">${t.net}</span></div>
          <div class="mf-stat-card"><span class="mf-stat-label">Gained</span><span class="mf-stat-value gained">+${t.gained}</span></div>
          <div class="mf-stat-card"><span class="mf-stat-label">Lost</span><span class="mf-stat-value lost">-${t.lost}</span></div>
          <div class="mf-stat-card"><span class="mf-stat-label">Present</span><span class="mf-stat-value present">${presentCount}</span></div>
          <div class="mf-stat-card"><span class="mf-stat-label">Late</span><span class="mf-stat-value late">${lateCount}</span></div>
          <div class="mf-stat-card"><span class="mf-stat-label">Absent</span><span class="mf-stat-value absent">${absentCount}</span></div>
          <div class="mf-stat-card"><span class="mf-stat-label">Meetings logged</span><span class="mf-stat-value">${attendanceRows.length}</span></div>
          <div class="mf-stat-card"><span class="mf-stat-label">Tests passed</span><span class="mf-stat-value present">${passCount}</span></div>
          <div class="mf-stat-card"><span class="mf-stat-label">Tests failed</span><span class="mf-stat-value absent">${failCount}</span></div>
        </div>
      </div>
      <div class="mf-slide">
        <h3 class="mf-slide-title">Point History</h3>
        ${log.length ? `<div class="mf-list">${log.map(e=>`
          <div class="mf-list-row">
            <span class="mf-list-date">${e.date}</span>
            <span class="mf-list-reason">${escapeHtml(e.reason||'')}</span>
            <span class="mf-list-amount ${e.amount>0?'gained':'lost'}">${e.amount>0?'+':''}${e.amount}</span>
          </div>
        `).join('')}</div>` : '<p class="empty-msg">No point history yet</p>'}
      </div>
      <div class="mf-slide">
        <h3 class="mf-slide-title">Attendance History</h3>
        ${attendanceRows.length ? `<div class="mf-list">${attendanceRows.map(r=>{
          const sel = normalizeRecord(r.record);
          const detail = attendanceDetailText(sel);
          const [uniformLabel, toolsLabel, overallLabel] = formatUniformToolsLabels(r.record, r.maxPoints);
          return `
          <div class="mf-list-row mf-list-row-wrap">
            <span class="mf-list-date">${r.date}</span>
            <span class="mf-list-reason">
              <span class="mf-att-tag ${sel.status}">${escapeHtml(statusLabel(sel.status))}${detail ? ' · ' + escapeHtml(detail) : ''}</span>
              <span class="mf-ut-inline">${escapeHtml(uniformLabel)} · ${escapeHtml(toolsLabel)} · ${escapeHtml(overallLabel)}</span>
            </span>
          </div>`;
        }).join('')}</div>` : '<p class="empty-msg">No attendance recorded yet</p>'}
      </div>
      <div class="mf-slide">
        <h3 class="mf-slide-title">Tests</h3>
        ${testRows.length ? `<div class="mf-list">${testRows.map(r=>`
          <div class="mf-list-row">
            <span class="mf-list-date">${r.date}</span>
            <span class="mf-list-reason">
              ${escapeHtml(r.name)}
              ${(r.score!==null && r.score!==undefined) ? ` · ${r.score}/${r.maxScore}` : ''}
            </span>
            <span class="mf-test-tag ${r.result}">${r.result==='pass' ? 'Pass' : 'Fail'}</span>
          </div>
        `).join('')}</div>` : '<p class="empty-msg">No tests recorded yet</p>'}
      </div>
    `;

    const dotsEl = document.getElementById('mfDots');
    dotsEl.innerHTML = Array.from({length: slidesEl.children.length}).map((_,i)=>
      `<button class="mf-dot ${i===0?'active':''}" data-slide="${i}"></button>`
    ).join('');

    mfCurrentSlide = 0;
    slidesEl.scrollLeft = 0;
    updateMfArrows();

    document.getElementById('memberFileOverlay').classList.add('show');
  }

  function closeMemberFile(){
    document.getElementById('memberFileOverlay').classList.remove('show');
  }

  function goToMfSlide(index){
    const slidesEl = document.getElementById('mfSlides');
    const slideCount = slidesEl.children.length;
    if(index < 0) index = 0;
    if(index > slideCount-1) index = slideCount-1;
    mfCurrentSlide = index;
    slidesEl.scrollTo({ left: index * slidesEl.clientWidth, behavior: 'smooth' });
    updateMfDots();
    updateMfArrows();
  }

  function updateMfDots(){
    document.querySelectorAll('.mf-dot').forEach((d,i)=>d.classList.toggle('active', i===mfCurrentSlide));
  }

  function updateMfArrows(){
    const slidesEl = document.getElementById('mfSlides');
    const slideCount = slidesEl.children.length;
    document.getElementById('mfPrevBtn').disabled = mfCurrentSlide <= 0;
    document.getElementById('mfNextBtn').disabled = mfCurrentSlide >= slideCount-1;
  }

  document.getElementById('mfCloseBtn').addEventListener('click', closeMemberFile);
  document.getElementById('memberFileOverlay').addEventListener('click', (e)=>{
    if(e.target.id === 'memberFileOverlay') closeMemberFile();
  });
  document.getElementById('mfPrevBtn').addEventListener('click', ()=>goToMfSlide(mfCurrentSlide-1));
  document.getElementById('mfNextBtn').addEventListener('click', ()=>goToMfSlide(mfCurrentSlide+1));
  document.getElementById('mfDots').addEventListener('click', (e)=>{
    const btn = e.target.closest('.mf-dot');
    if(!btn) return;
    goToMfSlide(parseInt(btn.dataset.slide, 10));
  });

  // Keep the dots/arrows in sync when someone swipes/scrolls the slides
  // directly instead of using the arrow buttons.
  let mfScrollTimeout = null;
  document.getElementById('mfSlides').addEventListener('scroll', ()=>{
    const slidesEl = document.getElementById('mfSlides');
    clearTimeout(mfScrollTimeout);
    mfScrollTimeout = setTimeout(()=>{
      const width = slidesEl.clientWidth || 1;
      mfCurrentSlide = Math.round(slidesEl.scrollLeft / width);
      updateMfDots();
      updateMfArrows();
    }, 80);
  });

  document.addEventListener('keydown', (e)=>{
    const overlay = document.getElementById('memberFileOverlay');
    if(!overlay.classList.contains('show')) return;
    if(e.key === 'Escape') closeMemberFile();
    if(e.key === 'ArrowRight') goToMfSlide(mfCurrentSlide+1);
    if(e.key === 'ArrowLeft') goToMfSlide(mfCurrentSlide-1);
  });

  // ---------- helpers ----------
  // Longer role text gets progressively smaller so it never crowds out
  // the name or points, while short roles like "Leader" stay easy to read.
  function roleFontSize(role){
    const len = role.length;
    if(len <= 8) return '0.78rem';
    if(len <= 14) return '0.7rem';
    if(len <= 20) return '0.63rem';
    if(len <= 28) return '0.57rem';
    return '0.52rem';
  }

  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  }
  function escapeAttr(str){ return escapeHtml(str); }

  // ---------- init ----------
  const savedRole = localStorage.getItem(ROLE_KEY);
  if(savedRole === 'editor' || savedRole === 'viewer'){
    startApp(savedRole);
  }
  // otherwise the login screen (shown by default) waits for a code
})();
