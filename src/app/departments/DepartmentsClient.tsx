'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './Departments.module.css';
import {
  createDepartment,
  renameDepartment,
  deleteDepartment,
  setDepartmentHead,
  removeDepartmentHead,
  assignManagerToDepartment,
} from '@/app/actions/departments';
import {
  createPendingManagerCard,
  deletePendingManagerCard,
  linkAccountToCard,
  setManagerRole,
} from '@/app/actions/accounts';
import { setDiscountThreshold } from '@/app/actions/discountPolicy';
import {
  setDepartmentDistributionRule,
  setProjectDepartment,
  setDistributionSettings,
  toggleManagerAvailability,
  DistributionRule,
} from '@/app/actions/leadDistribution';
import {
  getPendingHandoverItems,
  terminateManager,
  createSubstitution,
  cancelSubstitution,
} from '@/app/actions/employeeLifecycle';
import { canManageDepartments, canAssignDepartmentMembership, canManageSystem, ROLE_LABELS, UserRole } from '@/lib/roles';

interface ManagerRow {
  id: string;
  name: string;
  status: string;
  departmentId: string | null;
  departmentName: string | null;
  role: string | null;
  roleExpiresAt: string | null;
  availableForDistribution?: boolean;
}

interface DepartmentRow {
  id: string;
  name: string;
  organizationId: string;
  createdAt: string;
  headIds: string[];
  headNames: string[];
  memberCount: number;
  distributionRule: string;
}

interface ProjectRow {
  id: string;
  name: string;
  nameRu: string | null;
  departmentId: string | null;
  departmentName: string | null;
}

interface DistributionSettingsRow {
  organizationId: string;
  defaultDepartmentId: string | null;
  slaMinutes: number;
}

const RULE_LABELS: Record<string, string> = {
  MANUAL: 'Вручную',
  ROUND_ROBIN: 'По очереди',
  LEAST_LOAD: 'По наименьшей нагрузке',
};

interface UnlinkedAccountRow {
  id: string;
  organizationId: string;
  claimedName: string | null;
  claimedEmail: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface PendingCardRow {
  id: string;
  name: string;
  departmentId: string | null;
  departmentName: string | null;
  organizationId: string;
  createdById: string | null;
  createdAt: string;
}

interface AuditLogRow {
  id: string;
  targetManagerId: string | null;
  targetManagerName: string | null;
  action: string;
  details: string;
  initiatorId: string;
  reason: string | null;
  createdAt: string;
}

interface SubstitutionRow {
  id: string;
  managerId: string;
  managerName: string | null;
  substituteId: string;
  substituteName: string | null;
  startDate: string;
  endDate: string;
  cancelledAt: string | null;
}

interface Props {
  initialDepartments: DepartmentRow[];
  initialManagers: ManagerRow[];
  initialUnlinkedAccounts: UnlinkedAccountRow[];
  initialPendingCards: PendingCardRow[];
  initialAuditLog: AuditLogRow[];
  initialProjects: ProjectRow[];
  initialDistributionSettings: DistributionSettingsRow;
  initialDiscountThresholds: Record<string, number> | null;
  initialSubstitutions: SubstitutionRow[];
  organizationId: string;
  userRole?: string;
  managerId?: string;
}

const ROLE_OPTIONS: UserRole[] = ['admin', 'rop', 'senior_manager', 'manager', 'lawyer', 'marketing', 'call_center'];

function formatDateTime(v: string) {
  if (!v) return '—';
  const d = new Date(v);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDate(v: string) {
  if (!v) return '—';
  const d = new Date(v);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Колонки DATE из Postgres приходят через pg-драйвер как объекты Date, а не
// строки — .slice() на них упал бы в рантайме. Приводим к "YYYY-MM-DD"
// независимо от того, что реально пришло (Date или строка).
function toISODateStr(v: any): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

const ACTION_LABELS: Record<string, string> = {
  CARD_CREATED: 'Создана карточка',
  ACCOUNT_LINKED: 'Учётная запись связана',
  ROLE_ASSIGNED: 'Изменена роль',
  TERMINATED: 'Увольнение',
};

export default function DepartmentsClient({
  initialDepartments,
  initialManagers,
  initialUnlinkedAccounts,
  initialPendingCards,
  initialAuditLog,
  initialProjects,
  initialDistributionSettings,
  initialDiscountThresholds,
  initialSubstitutions,
  organizationId,
  userRole = 'manager',
  managerId = '',
}: Props) {
  const router = useRouter();
  const role = userRole as UserRole;
  const canManage = canManageDepartments(role); // создание/переименование/удаление отдела, руководители — только админ
  const canAssign = canAssignDepartmentMembership(role); // включение сотрудника в отдел — админ или РОП
  const canCreateCard = role === 'admin' || role === 'rop'; // "Создание карточки сотрудника"
  const canLinkAndAssignRole = canManageSystem(role); // "Связывание учётки" и "Назначение роли" — только админ
  const canViewAuditLog = role === 'admin' || role === 'rop';
  const canManageDistributionGlobal = canManageSystem(role); // ЖК→отдел, SLA, отдел по умолчанию — только админ
  const canManageDiscountPolicy = canManageSystem(role); // пороги скидок (BR-B05) — RACI: R = Админ
  const canManageLifecycle = canManageSystem(role); // увольнение/замещение (фаза 5) — RACI: R,A = Админ

  const [departments, setDepartments] = useState(initialDepartments);
  const [managers, setManagers] = useState(initialManagers);
  const [unlinkedAccounts, setUnlinkedAccounts] = useState(initialUnlinkedAccounts);
  const [pendingCards, setPendingCards] = useState(initialPendingCards);
  const [auditLog] = useState(initialAuditLog);
  const [projects, setProjects] = useState(initialProjects);
  const [distributionSettings, setDistributionSettingsState] = useState(initialDistributionSettings);
  const [discountThresholds, setDiscountThresholdsState] = useState<Record<string, number>>(
    initialDiscountThresholds || { manager: 3, senior_manager: 5, rop: 10, admin: Infinity, lawyer: 0, marketing: 0, call_center: 0 }
  );
  const [substitutions, setSubstitutions] = useState(initialSubstitutions);

  // Уволенные не участвуют в назначениях/выпадающих списках — но остаются
  // видны в журнале изменения прав (BR-B03: история не переписывается).
  const activeManagers = managers.filter(m => m.status !== 'TERMINATED');
  const [loading, setLoading] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newDeptName, setNewDeptName] = useState('');

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [showCardModal, setShowCardModal] = useState(false);
  const [cardName, setCardName] = useState('');
  const [cardDeptId, setCardDeptId] = useState('');

  // Модалка "Связать" — доступна из очереди несвязанных учёток и из черновиков карточек.
  const [linkTarget, setLinkTarget] = useState<{ accountId: string; pendingCardId?: string; suggestedName?: string } | null>(null);
  const [linkName, setLinkName] = useState('');
  const [linkDeptId, setLinkDeptId] = useState('');
  const [linkRole, setLinkRole] = useState<UserRole>('manager');
  const [linkExpires, setLinkExpires] = useState('');

  // Модалка "Изменить роль" — для уже связанного сотрудника, с опциональным сроком.
  const [roleEditTarget, setRoleEditTarget] = useState<ManagerRow | null>(null);
  const [roleEditRole, setRoleEditRole] = useState<UserRole>('manager');
  const [roleEditExpires, setRoleEditExpires] = useState('');
  const [roleEditReason, setRoleEditReason] = useState('');

  const [showAuditLog, setShowAuditLog] = useState(false);

  function canManageMembersOf(dept: DepartmentRow): boolean {
    if (role === 'admin') return true;
    if (role === 'rop') return dept.headIds.includes(managerId);
    return false;
  }

  async function refresh() {
    router.refresh();
  }

  const unassigned = activeManagers.filter(m => !m.departmentId);

  async function handleCreateDepartment() {
    if (!newDeptName.trim()) return alert('Укажите название отдела');
    setLoading(true);
    const res = await createDepartment(newDeptName, organizationId, managerId);
    setLoading(false);
    if (res.success) { setShowCreateModal(false); setNewDeptName(''); await refresh(); }
    else alert('Ошибка: ' + (res.error || ''));
  }

  async function handleRename(deptId: string) {
    if (!renameValue.trim()) return;
    setLoading(true);
    const res = await renameDepartment(deptId, renameValue, managerId);
    setLoading(false);
    if (res.success) { setRenamingId(null); await refresh(); }
    else alert('Ошибка: ' + (res.error || ''));
  }

  async function handleDelete(dept: DepartmentRow) {
    if (dept.memberCount > 0) return alert('В отделе ещё есть сотрудники — сначала переведите их в другой отдел');
    if (!confirm(`Удалить отдел «${dept.name}»?`)) return;
    setLoading(true);
    const res = await deleteDepartment(dept.id, managerId);
    setLoading(false);
    if (res.success) await refresh();
    else alert('Ошибка: ' + (res.error || ''));
  }

  async function handleAddHead(deptId: string, headManagerId: string) {
    if (!headManagerId) return;
    setLoading(true);
    const res = await setDepartmentHead(deptId, headManagerId, organizationId, managerId);
    setLoading(false);
    if (res.success) await refresh();
    else alert('Ошибка: ' + (res.error || ''));
  }

  async function handleRemoveHead(deptId: string, headManagerId: string) {
    setLoading(true);
    const res = await removeDepartmentHead(deptId, headManagerId, managerId);
    setLoading(false);
    if (res.success) await refresh();
    else alert('Ошибка: ' + (res.error || ''));
  }

  async function handleAddMember(deptId: string, targetManagerId: string) {
    if (!targetManagerId) return;
    setLoading(true);
    const res = await assignManagerToDepartment(targetManagerId, deptId, managerId);
    setLoading(false);
    if (res.success) await refresh();
    else alert('Ошибка: ' + (res.error || ''));
  }

  async function handleRemoveMember(targetManagerId: string) {
    setLoading(true);
    const res = await assignManagerToDepartment(targetManagerId, null, managerId);
    setLoading(false);
    if (res.success) await refresh();
    else alert('Ошибка: ' + (res.error || ''));
  }

  async function handleCreateCard() {
    if (!cardName.trim()) return alert('Укажите имя сотрудника');
    setLoading(true);
    const res = await createPendingManagerCard(cardName, cardDeptId || null, organizationId, managerId);
    setLoading(false);
    if (res.success) { setShowCardModal(false); setCardName(''); setCardDeptId(''); await refresh(); }
    else alert('Ошибка: ' + (res.error || ''));
  }

  async function handleDeleteCard(cardId: string) {
    if (!confirm('Удалить черновик карточки?')) return;
    setLoading(true);
    const res = await deletePendingManagerCard(cardId, managerId);
    setLoading(false);
    if (res.success) await refresh();
    else alert('Ошибка: ' + (res.error || ''));
  }

  function openLinkModal(accountId: string, pendingCardId?: string, suggestedName?: string) {
    setLinkTarget({ accountId, pendingCardId, suggestedName });
    setLinkName(suggestedName || '');
    setLinkDeptId('');
    setLinkRole('manager');
    setLinkExpires('');
  }

  async function handleConfirmLink() {
    if (!linkTarget) return;
    if (!linkTarget.pendingCardId && !linkName.trim()) return alert('Укажите имя сотрудника');
    setLoading(true);
    const res = await linkAccountToCard({
      accountId: linkTarget.accountId,
      pendingCardId: linkTarget.pendingCardId || null,
      name: linkName,
      departmentId: linkDeptId || null,
      role: linkRole,
      roleExpiresAt: linkExpires || null,
      organizationId,
      initiatorId: managerId,
    });
    setLoading(false);
    if (res.success) { setLinkTarget(null); await refresh(); }
    else alert('Ошибка: ' + (res.error || ''));
  }

  function openRoleEdit(m: ManagerRow) {
    setRoleEditTarget(m);
    setRoleEditRole((m.role as UserRole) || 'manager');
    setRoleEditExpires(toISODateStr(m.roleExpiresAt));
    setRoleEditReason('');
  }

  async function handleConfirmRoleEdit() {
    if (!roleEditTarget) return;
    if (!roleEditReason.trim()) return alert('Укажите основание изменения роли');
    setLoading(true);
    const res = await setManagerRole({
      managerId: roleEditTarget.id,
      role: roleEditRole,
      roleExpiresAt: roleEditExpires || null,
      reason: roleEditReason,
      organizationId,
      initiatorId: managerId,
    });
    setLoading(false);
    if (res.success) { setRoleEditTarget(null); await refresh(); }
    else alert('Ошибка: ' + (res.error || ''));
  }

  // ── Маршрутизация лидов (фаза 3) ──────────────────────────────────────────
  async function handleRuleChange(deptId: string, rule: DistributionRule) {
    setLoading(true);
    const res = await setDepartmentDistributionRule(deptId, rule, managerId);
    setLoading(false);
    if (res.success) await refresh();
    else alert('Ошибка: ' + (res.error || ''));
  }

  async function handleProjectDeptChange(projectId: string, deptId: string) {
    setLoading(true);
    const res = await setProjectDepartment(projectId, deptId || null, managerId);
    setLoading(false);
    if (res.success) await refresh();
    else alert('Ошибка: ' + (res.error || ''));
  }

  async function handleToggleAvailability(m: ManagerRow) {
    setLoading(true);
    const res = await toggleManagerAvailability(m.id, !(m.availableForDistribution ?? true), managerId);
    setLoading(false);
    if (res.success) await refresh();
    else alert('Ошибка: ' + (res.error || ''));
  }

  const [settingsDeptId, setSettingsDeptId] = useState(initialDistributionSettings.defaultDepartmentId || '');
  const [settingsSla, setSettingsSla] = useState(String(initialDistributionSettings.slaMinutes || 15));

  async function handleSaveDistributionSettings() {
    setLoading(true);
    const res = await setDistributionSettings({
      organizationId,
      defaultDepartmentId: settingsDeptId || null,
      slaMinutes: Number(settingsSla) || 15,
      initiatorId: managerId,
    });
    setLoading(false);
    if (res.success) await refresh();
    else alert('Ошибка: ' + (res.error || ''));
  }

  // ── Пороги согласования скидки (BR-B05) ───────────────────────────────────
  const [thresholdEdits, setThresholdEdits] = useState<Record<string, string>>({});
  async function handleSaveThreshold(r: UserRole) {
    const raw = thresholdEdits[r] ?? String(discountThresholds[r]);
    const value = raw.trim().toLowerCase() === 'inf' || raw.trim() === '' ? Infinity : Number(raw);
    if (!Number.isFinite(value) && value !== Infinity) return alert('Укажите число (или "inf" для без ограничений)');
    setLoading(true);
    const res = await setDiscountThreshold(r, value, organizationId, managerId);
    setLoading(false);
    if (res.success) {
      setDiscountThresholdsState(prev => ({ ...prev, [r]: value }));
      setThresholdEdits(prev => { const next = { ...prev }; delete next[r]; return next; });
    } else {
      alert('Ошибка: ' + (res.error || ''));
    }
  }

  // ── Увольнение (BR-B02, BR-B03, BR-B07) ───────────────────────────────────
  const [terminateTarget, setTerminateTarget] = useState<ManagerRow | null>(null);
  const [terminatePending, setTerminatePending] = useState<{ leads: any[]; deals: any[] } | null>(null);
  const [terminateSuccessorId, setTerminateSuccessorId] = useState('');
  const [terminateReason, setTerminateReason] = useState('');

  async function openTerminateModal(m: ManagerRow) {
    setTerminateTarget(m);
    setTerminateSuccessorId('');
    setTerminateReason('');
    setTerminatePending(null);
    const pending = await getPendingHandoverItems(m.id, organizationId);
    setTerminatePending(pending);
  }

  async function handleConfirmTerminate() {
    if (!terminateTarget) return;
    const totalPending = (terminatePending?.leads.length || 0) + (terminatePending?.deals.length || 0);
    if (totalPending > 0 && !terminateSuccessorId) {
      return alert('У сотрудника есть непереданные лиды/сделки — выберите преемника');
    }
    if (!terminateReason.trim()) return alert('Укажите основание увольнения');
    setLoading(true);
    const res = await terminateManager({
      managerId: terminateTarget.id,
      successorId: terminateSuccessorId || null,
      reason: terminateReason,
      organizationId,
      initiatorId: managerId,
    });
    setLoading(false);
    if (res.success) {
      alert(`Сотрудник уволен.${totalPending > 0 ? ` Передано преемнику: ${res.transferredLeads} лид(ов), ${res.transferredDeals} сделок.` : ''}`);
      setTerminateTarget(null);
      await refresh();
    } else {
      alert('Ошибка: ' + (res.error || ''));
    }
  }

  // ── Временное замещение на период отпуска ─────────────────────────────────
  const [showSubModal, setShowSubModal] = useState(false);
  const [subManagerId, setSubManagerId] = useState('');
  const [subSubstituteId, setSubSubstituteId] = useState('');
  const [subStart, setSubStart] = useState('');
  const [subEnd, setSubEnd] = useState('');

  async function handleCreateSubstitution() {
    if (!subManagerId || !subSubstituteId || !subStart || !subEnd) {
      return alert('Заполните все поля — дата окончания обязательна');
    }
    setLoading(true);
    const res = await createSubstitution({
      managerId: subManagerId,
      substituteId: subSubstituteId,
      startDate: subStart,
      endDate: subEnd,
      organizationId,
      initiatorId: managerId,
    });
    setLoading(false);
    if (res.success) {
      setShowSubModal(false);
      setSubManagerId(''); setSubSubstituteId(''); setSubStart(''); setSubEnd('');
      await refresh();
    } else {
      alert('Ошибка: ' + (res.error || ''));
    }
  }

  async function handleCancelSubstitution(id: string) {
    if (!confirm('Отменить замещение досрочно?')) return;
    setLoading(true);
    const res = await cancelSubstitution(id, managerId);
    setLoading(false);
    if (res.success) await refresh();
    else alert('Ошибка: ' + (res.error || ''));
  }

  function isSubstitutionActive(s: SubstitutionRow): boolean {
    if (s.cancelledAt) return false;
    const today = new Date().toISOString().slice(0, 10);
    const start = toISODateStr(s.startDate);
    const end = toISODateStr(s.endDate);
    return !!start && !!end && start <= today && today <= end;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleSection}>
          <h1>Отделы</h1>
          <p className={styles.subtitle}>
            Руководитель видит и ведёт данные только своих отделов. Сотрудник состоит ровно в одном отделе, руководитель может вести несколько.
          </p>
        </div>
        <div className={styles.actionsPanel}>
          {canCreateCard && (
            <button className={styles.btnSecondary} onClick={() => setShowCardModal(true)}>+ Карточка сотрудника</button>
          )}
          {canManage && (
            <button className={styles.btnPrimary} onClick={() => setShowCreateModal(true)}>+ Создать отдел</button>
          )}
        </div>
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Отделов</span>
          <span className={styles.statValue}>{departments.length}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Сотрудников распределено</span>
          <span className={styles.statValue}>{managers.length - unassigned.length}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Без отдела</span>
          <span className={styles.statValue}>{unassigned.length}</span>
        </div>
        {canLinkAndAssignRole && (
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Несвязанных учёток</span>
            <span className={styles.statValue}>{unlinkedAccounts.length}</span>
          </div>
        )}
      </div>

      {/* ── Отделы ─────────────────────────────────────────────────────── */}
      {departments.length === 0 ? (
        <div className={styles.emptyState}>
          Пока нет ни одного отдела. {canManage ? 'Создайте первый — кнопка выше.' : 'Обратитесь к администратору.'}
        </div>
      ) : (
        <div className={styles.deptGrid}>
          {departments.map(dept => {
            const canManageThis = canManageMembersOf(dept);
            const members = managers.filter(m => m.departmentId === dept.id);
            const candidatesForMember = activeManagers.filter(m => m.departmentId !== dept.id);
            const candidatesForHead = activeManagers.filter(m => !dept.headIds.includes(m.id));

            return (
              <div key={dept.id} className={styles.deptCard}>
                <div className={styles.deptCardHeader}>
                  {renamingId === dept.id ? (
                    <div className={styles.inlineEditRow}>
                      <input className={styles.input} value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus />
                      <button className={styles.smallBtn} onClick={() => handleRename(dept.id)} disabled={loading}>Ок</button>
                      <button className={styles.smallBtnSecondary} onClick={() => setRenamingId(null)}>Отмена</button>
                    </div>
                  ) : (
                    <>
                      <h3>{dept.name}</h3>
                      {canManage && (
                        <div className={styles.deptCardHeaderActions}>
                          <button className={styles.iconBtn} title="Переименовать" onClick={() => { setRenamingId(dept.id); setRenameValue(dept.name); }}>✎</button>
                          <button className={styles.iconBtn} title="Удалить отдел" onClick={() => handleDelete(dept)}>✕</button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className={styles.deptSection}>
                  <span className={styles.deptSectionLabel}>Руководитель(и)</span>
                  <div className={styles.chipRow}>
                    {dept.headIds.length === 0 && <span className={styles.emptyHint}>не назначен</span>}
                    {dept.headIds.map((hid, idx) => (
                      <span key={hid} className={styles.chip}>
                        {dept.headNames[idx]}
                        {canManage && <button className={styles.chipRemove} onClick={() => handleRemoveHead(dept.id, hid)} title="Снять с должности">×</button>}
                      </span>
                    ))}
                  </div>
                  {canManage && candidatesForHead.length > 0 && (
                    <select className={styles.smallSelect} value="" onChange={e => handleAddHead(dept.id, e.target.value)}>
                      <option value="">+ Назначить руководителя</option>
                      {candidatesForHead.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  )}
                </div>

                <div className={styles.deptSection}>
                  <span className={styles.deptSectionLabel}>Правило распределения лидов</span>
                  {canManageThis ? (
                    <select
                      className={styles.smallSelect}
                      value={dept.distributionRule}
                      onChange={e => handleRuleChange(dept.id, e.target.value as DistributionRule)}
                    >
                      {Object.entries(RULE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  ) : (
                    <span className={styles.emptyHint}>{RULE_LABELS[dept.distributionRule] || dept.distributionRule}</span>
                  )}
                </div>

                <div className={styles.deptSection}>
                  <span className={styles.deptSectionLabel}>Сотрудники ({members.length})</span>
                  <div className={styles.memberList}>
                    {members.length === 0 && <span className={styles.emptyHint}>пока никого нет</span>}
                    {members.map(m => (
                      <div key={m.id} className={styles.memberRow}>
                        <span>
                          {m.name}
                          {m.role && (
                            <span className={styles.roleTag}>
                              {ROLE_LABELS[m.role as UserRole] || m.role}
                              {m.roleExpiresAt ? ` до ${formatDate(m.roleExpiresAt)}` : ''}
                            </span>
                          )}
                          {m.availableForDistribution === false && (
                            <span className={styles.roleTag} style={{ background: '#fef2f2', color: '#991b1b', borderColor: '#fecaca' }}>
                              недоступен для распределения
                            </span>
                          )}
                        </span>
                        <span style={{ display: 'flex', gap: '4px' }}>
                          {canManageThis && (
                            <button
                              className={styles.iconBtn}
                              title={m.availableForDistribution === false ? 'Включить в распределение новых лидов' : 'Временно исключить из распределения новых лидов'}
                              onClick={() => handleToggleAvailability(m)}
                            >
                              {m.availableForDistribution === false ? '▶' : '⏸'}
                            </button>
                          )}
                          {canLinkAndAssignRole && (
                            <button className={styles.iconBtn} title="Изменить роль / выдать полномочия на срок" onClick={() => openRoleEdit(m)}>⚙</button>
                          )}
                          {canManageLifecycle && (
                            <button className={styles.iconBtn} title="Уволить" onClick={() => openTerminateModal(m)}>🚪</button>
                          )}
                          {canManageThis && (
                            <button className={styles.chipRemove} onClick={() => handleRemoveMember(m.id)} title="Убрать из отдела">×</button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                  {canManageThis && candidatesForMember.length > 0 && (
                    <select className={styles.smallSelect} value="" onChange={e => handleAddMember(dept.id, e.target.value)}>
                      <option value="">+ Добавить сотрудника</option>
                      {candidatesForMember.map(m => (
                        <option key={m.id} value={m.id}>{m.name}{m.departmentName ? ` (сейчас: ${m.departmentName})` : ''}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Без отдела ─────────────────────────────────────────────────── */}
      {canAssign && unassigned.length > 0 && (
        <div className={styles.unassignedSection}>
          <h3>Без отдела ({unassigned.length})</h3>
          <p className={styles.subtitle}>Эти сотрудники есть в справочнике, но пока не включены ни в один отдел.</p>
          <div className={styles.memberList}>
            {unassigned.map(m => (
              <div key={m.id} className={styles.memberRow}>
                <span>{m.name}</span>
                <span style={{ display: 'flex', gap: '6px' }}>
                  <select className={styles.smallSelect} value="" onChange={e => handleAddMember(e.target.value, m.id)}>
                    <option value="">→ В отдел...</option>
                    {departments.filter(d => role === 'admin' || d.headIds.includes(managerId)).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  {canManageLifecycle && (
                    <button className={styles.iconBtn} title="Уволить" onClick={() => openTerminateModal(m)}>🚪</button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Карточка сотрудника vs учётная запись (фаза 2) ────────────────── */}
      {canLinkAndAssignRole && (pendingCards.length > 0 || unlinkedAccounts.length > 0) && (
        <div className={styles.unassignedSection} style={{ borderColor: '#bfdbfe' }}>
          <h3 style={{ color: '#1e40af' }}>Карточки и учётные записи, ожидающие связывания</h3>
          <p className={styles.subtitle}>
            Учётная запись появляется здесь автоматически при первом входе сотрудника из ERP.
            Карточка — то, что вы завели заранее. Свяжите их и назначьте роль в один шаг.
          </p>

          {pendingCards.length > 0 && (
            <>
              <span className={styles.deptSectionLabel} style={{ display: 'block', margin: '14px 0 8px' }}>Черновики карточек ({pendingCards.length})</span>
              <div className={styles.memberList}>
                {pendingCards.map(c => (
                  <div key={c.id} className={styles.memberRow}>
                    <span>{c.name}{c.departmentName ? ` — ${c.departmentName}` : ' — без отдела'}</span>
                    <span style={{ display: 'flex', gap: '6px' }}>
                      <select
                        className={styles.smallSelect}
                        value=""
                        onChange={e => { if (e.target.value) openLinkModal(e.target.value, c.id, c.name); }}
                      >
                        <option value="">Связать с учётной записью...</option>
                        {unlinkedAccounts.map(a => (
                          <option key={a.id} value={a.id}>{a.claimedName || a.claimedEmail || a.id.slice(0, 8)}</option>
                        ))}
                      </select>
                      <button className={styles.chipRemove} onClick={() => handleDeleteCard(c.id)} title="Удалить черновик">×</button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {unlinkedAccounts.length > 0 && (
            <>
              <span className={styles.deptSectionLabel} style={{ display: 'block', margin: '14px 0 8px' }}>Несвязанные учётные записи ({unlinkedAccounts.length})</span>
              <div className={styles.memberList}>
                {unlinkedAccounts.map(a => (
                  <div key={a.id} className={styles.memberRow}>
                    <span>
                      {a.claimedName || a.claimedEmail || 'Без имени'}
                      <span className={styles.emptyHint} style={{ marginLeft: '6px' }}>первый вход: {formatDateTime(a.firstSeenAt)}</span>
                    </span>
                    <button className={styles.smallBtn} onClick={() => openLinkModal(a.id, undefined, a.claimedName || undefined)}>
                      Связать напрямую
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Маршрутизация лидов: ЖК→отдел, отдел по умолчанию, SLA (фаза 3) ── */}
      {canManageDistributionGlobal && (
        <div className={styles.unassignedSection} style={{ borderColor: '#bbf7d0' }}>
          <h3 style={{ color: '#166534' }}>Маршрутизация входящих лидов</h3>
          <p className={styles.subtitle}>
            Лид маршрутизируется в отдел, ведущий указанный в заявке ЖК. Если сопоставления нет — в отдел по умолчанию.
          </p>

          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '12px', marginBottom: '18px' }}>
            <div className={styles.formGroup} style={{ marginBottom: 0, minWidth: '220px' }}>
              <label>Отдел по умолчанию</label>
              <select className={styles.input} value={settingsDeptId} onChange={e => setSettingsDeptId(e.target.value)}>
                <option value="">Не задан</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className={styles.formGroup} style={{ marginBottom: 0, minWidth: '160px' }}>
              <label>SLA на распределение (мин.)</label>
              <input type="number" className={styles.input} value={settingsSla} onChange={e => setSettingsSla(e.target.value)} min={1} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className={styles.smallBtn} onClick={handleSaveDistributionSettings} disabled={loading}>Сохранить</button>
            </div>
          </div>

          <span className={styles.deptSectionLabel} style={{ display: 'block', marginBottom: '8px' }}>ЖК → отдел</span>
          <div className={styles.memberList}>
            {projects.length === 0 && <span className={styles.emptyHint}>Пока нет ни одного ЖК в каталоге</span>}
            {projects.map(p => (
              <div key={p.id} className={styles.memberRow}>
                <span>{p.nameRu || p.name}</span>
                <select className={styles.smallSelect} value={p.departmentId || ''} onChange={e => handleProjectDeptChange(p.id, e.target.value)}>
                  <option value="">Без отдела</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Пороги согласования скидки (BR-B05) — раньше хардкод в коде ───── */}
      {canManageDiscountPolicy && (
        <div className={styles.unassignedSection} style={{ borderColor: '#fbcfe8' }}>
          <h3 style={{ color: '#9d174d' }}>Пороги согласования скидки</h3>
          <p className={styles.subtitle}>
            Максимальный % скидки, который роль может сохранить самостоятельно — свыше него заявка уходит
            на согласование руководителю отдела менеджера (или админу, если в отделе нет руководителя).
            Изменение действует сразу, без релиза приложения.
          </p>
          <div className={styles.memberList} style={{ marginTop: '12px' }}>
            {ROLE_OPTIONS.map(r => (
              <div key={r} className={styles.memberRow}>
                <span>{ROLE_LABELS[r]}</span>
                <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    className={styles.input}
                    style={{ width: '90px' }}
                    value={thresholdEdits[r] ?? (discountThresholds[r] === Infinity ? 'inf' : String(discountThresholds[r]))}
                    onChange={e => setThresholdEdits(prev => ({ ...prev, [r]: e.target.value }))}
                    placeholder="% или inf"
                  />
                  <button className={styles.smallBtn} onClick={() => handleSaveThreshold(r)} disabled={loading}>Сохранить</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Временное замещение на период отпуска (фаза 5) ────────────────── */}
      {canManageLifecycle && (
        <div className={styles.unassignedSection} style={{ borderColor: '#c7d2fe' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ color: '#3730a3', margin: 0 }}>Временное замещение (отпуск)</h3>
            <button className={styles.btnSecondary} onClick={() => setShowSubModal(true)}>+ Оформить замещение</button>
          </div>
          <p className={styles.subtitle}>
            На период отпуска замещающий видит и ведёт объекты замещаемого как свои. По дате окончания
            доступ отзывается автоматически — отдельно отменять не нужно.
          </p>
          <div className={styles.memberList} style={{ marginTop: '12px' }}>
            {substitutions.length === 0 && <span className={styles.emptyHint}>Замещений пока не оформлено</span>}
            {substitutions.map(s => {
              const active = isSubstitutionActive(s);
              return (
                <div key={s.id} className={styles.memberRow}>
                  <span>
                    {s.managerName || s.managerId} → {s.substituteName || s.substituteId}
                    <span className={styles.emptyHint} style={{ marginLeft: '8px' }}>
                      {formatDate(s.startDate)} – {formatDate(s.endDate)}
                    </span>
                    {s.cancelledAt ? (
                      <span className={styles.roleTag} style={{ background: '#f1f5f9', color: '#64748b', borderColor: '#e2e8f0' }}>отменено</span>
                    ) : active ? (
                      <span className={styles.roleTag}>действует сейчас</span>
                    ) : null}
                  </span>
                  {!s.cancelledAt && (
                    <button className={styles.chipRemove} onClick={() => handleCancelSubstitution(s.id)} title="Отменить досрочно">×</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Журнал изменения прав (BR-B11) ───────────────────────────────── */}
      {canViewAuditLog && (
        <div className={styles.unassignedSection} style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Журнал изменения прав</h3>
            <button className={styles.smallBtnSecondary} onClick={() => setShowAuditLog(v => !v)}>
              {showAuditLog ? 'Скрыть' : `Показать (${auditLog.length})`}
            </button>
          </div>
          {showAuditLog && (
            <div className={styles.memberList} style={{ marginTop: '12px' }}>
              {auditLog.length === 0 && <span className={styles.emptyHint}>Изменений пока не было</span>}
              {auditLog.map(entry => (
                <div key={entry.id} className={styles.memberRow} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <strong style={{ fontSize: '0.82rem' }}>{ACTION_LABELS[entry.action] || entry.action}{entry.targetManagerName ? ` — ${entry.targetManagerName}` : ''}</strong>
                    <span className={styles.emptyHint}>{formatDateTime(entry.createdAt)}</span>
                  </div>
                  <span style={{ fontSize: '0.8rem', color: '#475569' }}>{entry.details}</span>
                  {entry.reason && <span style={{ fontSize: '0.78rem', color: '#92400e', fontStyle: 'italic' }}>Основание: {entry.reason}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Модалка: новый отдел ──────────────────────────────────────────── */}
      {showCreateModal && (
        <div className={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>Новый отдел</h2>
            <div className={styles.formGroup}>
              <label>Название</label>
              <input className={styles.input} value={newDeptName} onChange={e => setNewDeptName(e.target.value)} placeholder="Например: Отдел продаж — Центр" autoFocus />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setShowCreateModal(false)}>Отмена</button>
              <button className={styles.modalSaveBtn} onClick={handleCreateDepartment} disabled={loading}>{loading ? 'Создание...' : 'Создать'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Модалка: новая карточка сотрудника ────────────────────────────── */}
      {showCardModal && (
        <div className={styles.modalOverlay} onClick={() => setShowCardModal(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>Карточка сотрудника</h2>
            <p className={styles.subtitle} style={{ marginBottom: '14px' }}>
              Заведите карточку заранее, до первого входа сотрудника. Когда он войдёт из ERP,
              администратор свяжет его учётную запись с этой карточкой.
            </p>
            <div className={styles.formGroup}>
              <label>Имя сотрудника</label>
              <input className={styles.input} value={cardName} onChange={e => setCardName(e.target.value)} autoFocus />
            </div>
            <div className={styles.formGroup}>
              <label>Отдел</label>
              <select className={styles.input} value={cardDeptId} onChange={e => setCardDeptId(e.target.value)}>
                <option value="">Без отдела</option>
                {departments.filter(d => role === 'admin' || d.headIds.includes(managerId)).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setShowCardModal(false)}>Отмена</button>
              <button className={styles.modalSaveBtn} onClick={handleCreateCard} disabled={loading}>{loading ? 'Создание...' : 'Создать карточку'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Модалка: связать учётку + назначить роль (один шаг) ───────────── */}
      {linkTarget && (
        <div className={styles.modalOverlay} onClick={() => setLinkTarget(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>Связать учётную запись</h2>
            {!linkTarget.pendingCardId && (
              <div className={styles.formGroup}>
                <label>Имя сотрудника</label>
                <input className={styles.input} value={linkName} onChange={e => setLinkName(e.target.value)} autoFocus />
              </div>
            )}
            {!linkTarget.pendingCardId && (
              <div className={styles.formGroup}>
                <label>Отдел</label>
                <select className={styles.input} value={linkDeptId} onChange={e => setLinkDeptId(e.target.value)}>
                  <option value="">Без отдела</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            )}
            <div className={styles.formGroup}>
              <label>Роль</label>
              <select className={styles.input} value={linkRole} onChange={e => setLinkRole(e.target.value as UserRole)}>
                {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label>Полномочия действуют до (необязательно — оставьте пустым для бессрочных)</label>
              <input type="date" className={styles.input} value={linkExpires} onChange={e => setLinkExpires(e.target.value)} />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setLinkTarget(null)}>Отмена</button>
              <button className={styles.modalSaveBtn} onClick={handleConfirmLink} disabled={loading}>{loading ? 'Связывание...' : 'Связать и назначить роль'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Модалка: изменить роль сотрудника (в т.ч. на срок) ────────────── */}
      {roleEditTarget && (
        <div className={styles.modalOverlay} onClick={() => setRoleEditTarget(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>Роль сотрудника: {roleEditTarget.name}</h2>
            <div className={styles.formGroup}>
              <label>Роль</label>
              <select className={styles.input} value={roleEditRole} onChange={e => setRoleEditRole(e.target.value as UserRole)}>
                {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label>Полномочия действуют до (необязательно)</label>
              <input type="date" className={styles.input} value={roleEditExpires} onChange={e => setRoleEditExpires(e.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label>Основание изменения (обязательно)</label>
              <input className={styles.input} value={roleEditReason} onChange={e => setRoleEditReason(e.target.value)} placeholder="Например: временная замена на период отпуска РОПа" />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setRoleEditTarget(null)}>Отмена</button>
              <button className={styles.modalSaveBtn} onClick={handleConfirmRoleEdit} disabled={loading}>{loading ? 'Сохранение...' : 'Сохранить'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Модалка: увольнение (BR-B02, BR-B03, BR-B07) ──────────────────── */}
      {terminateTarget && (
        <div className={styles.modalOverlay} onClick={() => setTerminateTarget(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>Увольнение: {terminateTarget.name}</h2>
            {terminatePending === null ? (
              <p className={styles.subtitle}>Проверяем незакрытые объекты...</p>
            ) : (
              <>
                {(terminatePending.leads.length > 0 || terminatePending.deals.length > 0) ? (
                  <>
                    <p className={styles.subtitle} style={{ color: '#991b1b' }}>
                      У сотрудника {terminatePending.leads.length} незакрытых лид(ов) и {terminatePending.deals.length} незакрытых сделок —
                      без преемника уволить нельзя (BR-B02).
                    </p>
                    <div className={styles.formGroup}>
                      <label>Преемник — кому передать</label>
                      <select className={styles.input} value={terminateSuccessorId} onChange={e => setTerminateSuccessorId(e.target.value)}>
                        <option value="">-- Выберите преемника --</option>
                        {activeManagers.filter(m => m.id !== terminateTarget.id).map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : (
                  <p className={styles.subtitle}>Незакрытых лидов и сделок нет — передавать нечего.</p>
                )}
                <div className={styles.formGroup}>
                  <label>Основание увольнения (для журнала изменения прав)</label>
                  <input className={styles.input} value={terminateReason} onChange={e => setTerminateReason(e.target.value)} placeholder="Например: расторжение трудового договора по инициативе сотрудника" />
                </div>
                <div className={styles.modalActions}>
                  <button className={styles.modalCancelBtn} onClick={() => setTerminateTarget(null)}>Отмена</button>
                  <button className={styles.modalSaveBtn} onClick={handleConfirmTerminate} disabled={loading} style={{ background: '#991b1b' }}>
                    {loading ? 'Увольнение...' : 'Уволить'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Модалка: оформление временного замещения ──────────────────────── */}
      {showSubModal && (
        <div className={styles.modalOverlay} onClick={() => setShowSubModal(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>Временное замещение</h2>
            <div className={styles.formGroup}>
              <label>Кто уходит (замещаемый)</label>
              <select className={styles.input} value={subManagerId} onChange={e => setSubManagerId(e.target.value)}>
                <option value="">-- Выберите сотрудника --</option>
                {activeManagers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label>Кто замещает</label>
              <select className={styles.input} value={subSubstituteId} onChange={e => setSubSubstituteId(e.target.value)}>
                <option value="">-- Выберите сотрудника --</option>
                {activeManagers.filter(m => m.id !== subManagerId).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <div className={styles.formGroup} style={{ flex: 1 }}>
                <label>С даты</label>
                <input type="date" className={styles.input} value={subStart} onChange={e => setSubStart(e.target.value)} />
              </div>
              <div className={styles.formGroup} style={{ flex: 1 }}>
                <label>По дату (обязательно)</label>
                <input type="date" className={styles.input} value={subEnd} onChange={e => setSubEnd(e.target.value)} />
              </div>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setShowSubModal(false)}>Отмена</button>
              <button className={styles.modalSaveBtn} onClick={handleCreateSubstitution} disabled={loading}>{loading ? 'Сохранение...' : 'Оформить'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
