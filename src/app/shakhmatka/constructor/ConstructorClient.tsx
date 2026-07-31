"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createProjectAction,
  generateBlockAndUnitsAction,
} from "@/app/actions/units";
import styles from "../Shakhmatka.module.css";

interface Props {
  projects: { id: string; name: string; nameRu?: string }[];
  organizationId: string;
}

type Step = "project" | "block" | "templates";

const EMPTY_PROJECT = {
  name: "",
  code: "",
  address: "",
  description: "",
  expectedCompletionDate: "",
};

export default function ConstructorClient({ projects, organizationId }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("project");
  const [loading, setLoading] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);

  // Выбранный существующий ЖК
  const [selectedExistingId, setSelectedExistingId] = useState<string | null>(
    null,
  );
  // Форма нового ЖК
  const [newProjectData, setNewProjectData] = useState(EMPTY_PROJECT);
  // Модалка подтверждения переключения
  const [confirmModal, setConfirmModal] = useState<
    null | "clearSelection" | "clearForm"
  >(null);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);

  // Данные корпуса
  const [newBlockData, setNewBlockData] = useState({
    projectId: "",
    blockNumber: "",
    floorCount: 10,
    entranceCount: 4,
    unitsPerFloorPerEntrance: 3,
    defaultArea: 60,
    defaultPricePerSqm: 1500,
    defaultRooms: 2,
    expectedCommissioningDate: "",
  });

  const [unitTemplates, setUnitTemplates] = useState<
    { area: number; pricePerSqm: number; rooms: number }[]
  >([]);

  const syncTemplates = (count: number) => {
    setUnitTemplates((prev) => {
      const next = [];
      for (let i = 0; i < count; i++) {
        next.push(
          prev[i] || {
            area: newBlockData.defaultArea,
            pricePerSqm: newBlockData.defaultPricePerSqm,
            rooms: newBlockData.defaultRooms,
          },
        );
      }
      return next;
    });
  };

  // Проверки состояния шага 1
  const formHasData =
    newProjectData.name.trim() !== "" || newProjectData.code.trim() !== "";
  const formIsComplete =
    newProjectData.name.trim() !== "" && newProjectData.code.trim() !== "";
  const canContinue = selectedExistingId !== null || formIsComplete;

  // Клик на существующий ЖК
  const handleSelectExisting = (id: string) => {
    if (formHasData) {
      // Форма заполнена — спрашиваем
      setPendingProjectId(id);
      setConfirmModal("clearForm");
    } else {
      setSelectedExistingId(id);
    }
  };

  // Начали вводить в форму
  const handleFormChange = (field: string, value: string) => {
    if (selectedExistingId !== null && value.trim() !== "") {
      // Уже выбран ЖК — спрашиваем
      setPendingProjectId(null);
      setConfirmModal("clearSelection");
      // Применяем изменение поля сразу, но покажем диалог
      setNewProjectData((prev) => ({ ...prev, [field]: value }));
    } else {
      setNewProjectData((prev) => ({ ...prev, [field]: value }));
    }
  };

  const handleConfirm = () => {
    if (confirmModal === "clearForm") {
      // Стираем форму, выбираем существующий
      setNewProjectData(EMPTY_PROJECT);
      setSelectedExistingId(pendingProjectId);
    } else if (confirmModal === "clearSelection") {
      // Снимаем выбор
      setSelectedExistingId(null);
    }
    setConfirmModal(null);
    setPendingProjectId(null);
  };

  const handleContinueFromProject = async () => {
    if (selectedExistingId) {
      setNewBlockData((prev) => ({ ...prev, projectId: selectedExistingId }));
      setStep("block");
    } else if (formIsComplete) {
      setLoading(true);
      const res = await createProjectAction({
        ...newProjectData,
        organizationId,
      });
      setLoading(false);
      if (res.success && res.projectId) {
        setCreatedProjectId(res.projectId);
        setNewBlockData((prev) => ({ ...prev, projectId: res.projectId! }));
        setStep("block");
      } else {
        alert("Ошибка при создании ЖК: " + (res.error || "Неизвестная ошибка"));
      }
    }
  };

  const handleGenerateBlock = async () => {
    if (!newBlockData.projectId || !newBlockData.blockNumber) {
      alert("Выберите ЖК и укажите номер корпуса");
      return;
    }
    setLoading(true);
    const res = await generateBlockAndUnitsAction({
      ...newBlockData,
      organizationId,
      unitTemplates: unitTemplates.length > 0 ? unitTemplates : undefined,
    });
    setLoading(false);
    if (res.success) {
      alert(" Корпус создан, шахматка сгенерирована!");
      router.push("/shakhmatka");
    } else {
      alert("Ошибка: " + (res.error || "Неизвестная ошибка"));
    }
  };

  const STEPS: { key: Step; label: string; icon: string }[] = [
    { key: "project", label: "Создать ЖК", icon: "" },
    { key: "block", label: "Настроить корпус", icon: "" },
    { key: "templates", label: "Параметры квартир", icon: "" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: "40px" }}>
      {/* Модалка подтверждения */}
      {confirmModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.4)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: "16px",
              padding: "28px",
              maxWidth: "400px",
              width: "90%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
            }}
          >
            <h3
              style={{
                fontSize: "1.1rem",
                fontWeight: 700,
                margin: "0 0 10px",
              }}
            >
              {confirmModal === "clearForm"
                ? "Сбросить данные формы?"
                : "Снять выбор ЖК?"}
            </h3>
            <p
              style={{
                color: "#64748b",
                margin: "0 0 20px",
                fontSize: "0.9rem",
              }}
            >
              {confirmModal === "clearForm"
                ? "Вы выбрали существующий ЖК. Введённые данные для нового ЖК будут стёрты."
                : "Вы начали вводить данные нового ЖК. Выбранный ЖК будет снят."}
            </p>
            <div
              style={{
                display: "flex",
                gap: "10px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={() => {
                  setConfirmModal(null);
                  setPendingProjectId(null);
                }}
                style={{
                  background: "white",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "8px 16px",
                  cursor: "pointer",
                  color: "#475569",
                  fontWeight: 600,
                }}
              >
                Отмена
              </button>
              <button
                onClick={handleConfirm}
                style={{
                  background: "#ef4444",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 16px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                {confirmModal === "clearForm" ? "Стереть форму" : "Снять выбор"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Шапка */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "32px",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "1.8rem",
              fontWeight: 800,
              color: "#0f172a",
              margin: 0,
            }}
          >
            {" "}
            Конструктор шахматки
          </h1>
          <p style={{ color: "#64748b", marginTop: "4px" }}>
            Создайте жилой комплекс и сгенерируйте шахматку
          </p>
        </div>
        <button
          onClick={() => router.push("/shakhmatka")}
          style={{
            background: "white",
            border: "1px solid #e2e8f0",
            borderRadius: "10px",
            padding: "10px 20px",
            cursor: "pointer",
            color: "#475569",
            fontWeight: 600,
          }}
        >
          ← Вернуться к шахматке
        </button>
      </div>

      {/* Навигация по шагам */}
      <div
        style={{
          display: "flex",
          marginBottom: "32px",
          background: "white",
          borderRadius: "14px",
          border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}
      >
        {STEPS.map((s, idx) => {
          const isActive = step === s.key;
          const isDone = STEPS.findIndex((x) => x.key === step) > idx;
          return (
            <button
              key={s.key}
              onClick={() => {
                if (isDone || isActive) setStep(s.key);
              }}
              style={{
                flex: 1,
                padding: "18px 24px",
                background: isActive ? "#eff6ff" : "white",
                border: "none",
                borderRight:
                  idx < STEPS.length - 1 ? "1px solid #e2e8f0" : "none",
                cursor: isDone
                  ? "pointer"
                  : isActive
                    ? "default"
                    : "not-allowed",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                opacity: isDone || isActive ? 1 : 0.4,
              }}
            >
              <span style={{ fontSize: "1.4rem" }}>{isDone ? "" : s.icon}</span>
              <div style={{ textAlign: "left" }}>
                <div
                  style={{
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    color: isActive ? "#1d4ed8" : "#94a3b8",
                    letterSpacing: "0.05em",
                  }}
                >
                  Шаг {idx + 1}
                </div>
                <div
                  style={{
                    fontSize: "0.95rem",
                    fontWeight: 700,
                    color: isActive
                      ? "#1d4ed8"
                      : isDone
                        ? "#166534"
                        : "#475569",
                  }}
                >
                  {s.label}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Контент */}
      <div
        style={{
          background: "white",
          borderRadius: "16px",
          border: "1px solid #e2e8f0",
          padding: "32px",
        }}
      >
        {/* ШАГ 1 */}
        {step === "project" && (
          <div>
            <h2
              style={{
                fontSize: "1.3rem",
                fontWeight: 800,
                color: "#0f172a",
                marginBottom: "8px",
              }}
            >
              {" "}
              Шаг 1: Жилой комплекс
            </h2>
            <p style={{ color: "#64748b", marginBottom: "28px" }}>
              Выберите существующий ЖК или создайте новый
            </p>

            {/* Выбор существующего */}
            {projects.length > 0 && (
              <div
                style={{
                  marginBottom: "28px",
                  padding: "20px",
                  background: "#f8fafc",
                  borderRadius: "12px",
                  border: "1px solid #e2e8f0",
                }}
              >
                <label
                  style={{
                    display: "block",
                    fontWeight: 700,
                    marginBottom: "12px",
                    color: "#475569",
                    fontSize: "0.85rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  Существующий ЖК
                </label>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {projects.map((p) => {
                    const isSelected = selectedExistingId === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => handleSelectExisting(p.id)}
                        style={{
                          padding: "10px 18px",
                          background: isSelected ? "#eff6ff" : "white",
                          border: `1px solid ${isSelected ? "#3b82f6" : "#e2e8f0"}`,
                          borderRadius: "10px",
                          cursor: "pointer",
                          fontWeight: 600,
                          color: isSelected ? "#1d4ed8" : "#1e293b",
                          transition: "all 0.15s",
                        }}
                      >
                        {isSelected ? "" : ""}
                        {p.nameRu || p.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Разделитель */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                marginBottom: "24px",
              }}
            >
              <div style={{ flex: 1, height: "1px", background: "#e2e8f0" }} />
              <span
                style={{
                  color: "#94a3b8",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                }}
              >
                или создать новый
              </span>
              <div style={{ flex: 1, height: "1px", background: "#e2e8f0" }} />
            </div>

            {/* Форма нового ЖК — поля в столбик на всю ширину */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "14px",
                marginBottom: "28px",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr",
                  gap: "14px",
                }}
              >
                <div className={styles.formGroup} style={{ margin: 0 }}>
                  <label>Название ЖК *</label>
                  <input
                    className={styles.input}
                    placeholder="Например: ЖК Park Boulevard"
                    value={newProjectData.name}
                    onChange={(e) => handleFormChange("name", e.target.value)}
                  />
                </div>
                <div className={styles.formGroup} style={{ margin: 0 }}>
                  <label>Код проекта *</label>
                  <input
                    className={styles.input}
                    placeholder="Например: PB"
                    value={newProjectData.code}
                    onChange={(e) => handleFormChange("code", e.target.value)}
                  />
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr",
                  gap: "14px",
                }}
              >
                <div className={styles.formGroup} style={{ margin: 0 }}>
                  <label>Адрес ЖК</label>
                  <input
                    className={styles.input}
                    placeholder="г. Тбилиси, ул. Руставели 12"
                    value={newProjectData.address}
                    onChange={(e) =>
                      handleFormChange("address", e.target.value)
                    }
                  />
                </div>
                <div className={styles.formGroup} style={{ margin: 0 }}>
                  <label>Дата ввода в эксплуатацию</label>
                  <input
                    type="date"
                    className={styles.input}
                    value={newProjectData.expectedCompletionDate}
                    onChange={(e) =>
                      handleFormChange("expectedCompletionDate", e.target.value)
                    }
                  />
                </div>
              </div>
              <div className={styles.formGroup} style={{ margin: 0 }}>
                <label>Описание проекта</label>
                <textarea
                  className={styles.input}
                  style={{ minHeight: "72px", resize: "vertical" }}
                  placeholder="Параметры и особенности жилого комплекса..."
                  value={newProjectData.description}
                  onChange={(e) =>
                    handleFormChange("description", e.target.value)
                  }
                />
              </div>
            </div>

            {/* Кнопка Продолжить */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={handleContinueFromProject}
                disabled={!canContinue || loading}
                style={{
                  background: canContinue ? "#2563eb" : "#e2e8f0",
                  color: canContinue ? "white" : "#94a3b8",
                  border: "none",
                  borderRadius: "10px",
                  padding: "12px 32px",
                  fontWeight: 700,
                  fontSize: "0.95rem",
                  cursor: canContinue ? "pointer" : "not-allowed",
                  transition: "all 0.2s",
                }}
              >
                {loading ? "Создание..." : "Продолжить →"}
              </button>
            </div>
          </div>
        )}

        {/* ШАГ 2 */}
        {step === "block" && (
          <div>
            <h2
              style={{
                fontSize: "1.3rem",
                fontWeight: 800,
                color: "#0f172a",
                marginBottom: "8px",
              }}
            >
              {" "}
              Шаг 2: Параметры корпуса
            </h2>
            <p style={{ color: "#64748b", marginBottom: "28px" }}>
              Укажите структуру корпуса: этажность, подъезды и количество
              квартир на этаже
            </p>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                marginBottom: "28px",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr",
                  gap: "14px",
                }}
              >
                <div className={styles.formGroup} style={{ margin: 0 }}>
                  <label>ЖК *</label>
                  <select
                    className={styles.input}
                    value={newBlockData.projectId}
                    onChange={(e) =>
                      setNewBlockData({
                        ...newBlockData,
                        projectId: e.target.value,
                      })
                    }
                  >
                    <option value="">Выберите проект...</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nameRu || p.name}
                      </option>
                    ))}
                    {createdProjectId && (
                      <option value={createdProjectId}>
                        ← Только что созданный
                      </option>
                    )}
                  </select>
                </div>
                <div className={styles.formGroup} style={{ margin: 0 }}>
                  <label>Номер / имя корпуса *</label>
                  <input
                    className={styles.input}
                    placeholder="Например: Блок А"
                    value={newBlockData.blockNumber}
                    onChange={(e) =>
                      setNewBlockData({
                        ...newBlockData,
                        blockNumber: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: "14px",
                }}
              >
                <div className={styles.formGroup} style={{ margin: 0 }}>
                  <label>Кол-во этажей</label>
                  <input
                    type="number"
                    min="1"
                    className={styles.input}
                    value={newBlockData.floorCount}
                    onChange={(e) =>
                      setNewBlockData({
                        ...newBlockData,
                        floorCount: parseInt(e.target.value) || 0,
                      })
                    }
                  />
                </div>
                <div className={styles.formGroup} style={{ margin: 0 }}>
                  <label>Кол-во подъездов</label>
                  <input
                    type="number"
                    min="1"
                    className={styles.input}
                    value={newBlockData.entranceCount}
                    onChange={(e) =>
                      setNewBlockData({
                        ...newBlockData,
                        entranceCount: parseInt(e.target.value) || 0,
                      })
                    }
                  />
                </div>
                <div className={styles.formGroup} style={{ margin: 0 }}>
                  <label>Квартир на этаж/подъезд</label>
                  <input
                    type="number"
                    min="1"
                    className={styles.input}
                    value={newBlockData.unitsPerFloorPerEntrance}
                    onChange={(e) => {
                      const count = parseInt(e.target.value) || 0;
                      setNewBlockData({
                        ...newBlockData,
                        unitsPerFloorPerEntrance: count,
                      });
                      syncTemplates(count);
                    }}
                  />
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 2fr",
                  gap: "14px",
                }}
              >
                <div className={styles.formGroup} style={{ margin: 0 }}>
                  <label>Ожидаемая дата сдачи</label>
                  <input
                    type="date"
                    className={styles.input}
                    value={newBlockData.expectedCommissioningDate}
                    onChange={(e) =>
                      setNewBlockData({
                        ...newBlockData,
                        expectedCommissioningDate: e.target.value,
                      })
                    }
                  />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <div
                    style={{
                      padding: "12px 16px",
                      background: "#f0fdf4",
                      borderRadius: "10px",
                      border: "1px solid #bbf7d0",
                      fontSize: "0.85rem",
                      color: "#166534",
                      width: "100%",
                    }}
                  >
                    Итого квартир:{" "}
                    <strong>
                      {newBlockData.floorCount *
                        newBlockData.entranceCount *
                        newBlockData.unitsPerFloorPerEntrance}
                    </strong>
                    {""}({newBlockData.floorCount} эт. ×{" "}
                    {newBlockData.entranceCount} пд. ×{" "}
                    {newBlockData.unitsPerFloorPerEntrance} кв.)
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button
                onClick={() => setStep("project")}
                style={{
                  background: "white",
                  border: "1px solid #e2e8f0",
                  borderRadius: "10px",
                  padding: "12px 24px",
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "#475569",
                }}
              >
                ← Назад
              </button>
              <button
                onClick={() => {
                  syncTemplates(newBlockData.unitsPerFloorPerEntrance);
                  setStep("templates");
                }}
                disabled={!newBlockData.blockNumber || !newBlockData.projectId}
                style={{
                  background:
                    newBlockData.blockNumber && newBlockData.projectId
                      ? "#2563eb"
                      : "#e2e8f0",
                  color:
                    newBlockData.blockNumber && newBlockData.projectId
                      ? "white"
                      : "#94a3b8",
                  border: "none",
                  borderRadius: "10px",
                  padding: "12px 28px",
                  fontWeight: 700,
                  cursor:
                    newBlockData.blockNumber && newBlockData.projectId
                      ? "pointer"
                      : "not-allowed",
                  transition: "all 0.2s",
                }}
              >
                Продолжить →
              </button>
            </div>
          </div>
        )}

        {/* ШАГ 3 */}
        {step === "templates" && (
          <div>
            <h2
              style={{
                fontSize: "1.3rem",
                fontWeight: 800,
                color: "#0f172a",
                marginBottom: "8px",
              }}
            >
              {" "}
              Шаг 3: Параметры квартир
            </h2>
            <p style={{ color: "#64748b", marginBottom: "4px" }}>
              Параметры для каждой позиции на этаже — применятся ко всем{" "}
              {newBlockData.floorCount} этажам и {newBlockData.entranceCount}{" "}
              подъездам
            </p>
            <p
              style={{
                color: "#94a3b8",
                fontSize: "0.82rem",
                marginBottom: "24px",
              }}
            >
              Квартиры в одном стояке (друг над другом) имеют одинаковую
              планировку
            </p>

            {/* Дефолты */}
            <div
              style={{
                display: "flex",
                gap: "16px",
                marginBottom: "20px",
                padding: "16px 20px",
                background: "#f8fafc",
                borderRadius: "10px",
                border: "1px solid #e2e8f0",
                alignItems: "flex-end",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{ display: "flex", flexDirection: "column", gap: "6px" }}
              >
                <label
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "#64748b",
                    whiteSpace: "nowrap",
                  }}
                >
                  Площадь по умолч. (м²)
                </label>
                <input
                  type="number"
                  step="0.1"
                  className={styles.input}
                  style={{ width: "120px" }}
                  value={newBlockData.defaultArea}
                  onChange={(e) =>
                    setNewBlockData({
                      ...newBlockData,
                      defaultArea: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: "6px" }}
              >
                <label
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "#64748b",
                    whiteSpace: "nowrap",
                  }}
                >
                  Цена за м² по умолч. ($)
                </label>
                <input
                  type="number"
                  className={styles.input}
                  style={{ width: "140px" }}
                  value={newBlockData.defaultPricePerSqm}
                  onChange={(e) =>
                    setNewBlockData({
                      ...newBlockData,
                      defaultPricePerSqm: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: "6px" }}
              >
                <label
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "#64748b",
                    whiteSpace: "nowrap",
                  }}
                >
                  Комнат по умолч.
                </label>
                <input
                  type="number"
                  min="1"
                  className={styles.input}
                  style={{ width: "90px" }}
                  value={newBlockData.defaultRooms}
                  onChange={(e) =>
                    setNewBlockData({
                      ...newBlockData,
                      defaultRooms: parseInt(e.target.value) || 1,
                    })
                  }
                />
              </div>
              <button
                onClick={() =>
                  syncTemplates(newBlockData.unitsPerFloorPerEntrance)
                }
                style={{
                  height: "42px",
                  padding: "0 20px",
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: "8px",
                  color: "#1d4ed8",
                  fontWeight: 700,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  alignSelf: "flex-end",
                }}
              >
                Применить ко всем
              </button>
            </div>

            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.9rem",
                marginBottom: "28px",
              }}
            >
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {[
                    "Позиция",
                    "Комнат",
                    "Площадь (м²)",
                    "Цена за м² ($)",
                    "Итого ($)",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "12px 16px",
                        textAlign: "left",
                        color: "#64748b",
                        fontWeight: 700,
                        fontSize: "0.75rem",
                        textTransform: "uppercase",
                        borderBottom: "2px solid #e2e8f0",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({
                  length: newBlockData.unitsPerFloorPerEntrance,
                }).map((_, i) => {
                  const tpl = unitTemplates[i] || {
                    area: newBlockData.defaultArea,
                    pricePerSqm: newBlockData.defaultPricePerSqm,
                    rooms: newBlockData.defaultRooms,
                  };
                  const total = Math.round(tpl.area * tpl.pricePerSqm);
                  const update = (field: string, value: number) => {
                    const next = [...unitTemplates];
                    while (next.length <= i)
                      next.push({
                        area: newBlockData.defaultArea,
                        pricePerSqm: newBlockData.defaultPricePerSqm,
                        rooms: newBlockData.defaultRooms,
                      });
                    next[i] = { ...next[i], [field]: value };
                    setUnitTemplates(next);
                  };
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td
                        style={{
                          padding: "12px 16px",
                          color: "#94a3b8",
                          fontWeight: 700,
                        }}
                      >
                        {i + 1}-я кв.
                      </td>
                      <td style={{ padding: "8px 16px" }}>
                        <input
                          type="number"
                          min="1"
                          max="10"
                          className={styles.input}
                          style={{ width: "70px", padding: "6px 8px" }}
                          value={tpl.rooms}
                          onChange={(e) =>
                            update("rooms", parseInt(e.target.value) || 1)
                          }
                        />
                      </td>
                      <td style={{ padding: "8px 16px" }}>
                        <input
                          type="number"
                          step="0.1"
                          min="1"
                          className={styles.input}
                          style={{ width: "110px", padding: "6px 8px" }}
                          value={tpl.area}
                          onChange={(e) =>
                            update("area", parseFloat(e.target.value) || 0)
                          }
                        />
                      </td>
                      <td style={{ padding: "8px 16px" }}>
                        <input
                          type="number"
                          min="1"
                          className={styles.input}
                          style={{ width: "110px", padding: "6px 8px" }}
                          value={tpl.pricePerSqm}
                          onChange={(e) =>
                            update(
                              "pricePerSqm",
                              parseFloat(e.target.value) || 0,
                            )
                          }
                        />
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          fontWeight: 700,
                          color: "#1e293b",
                          fontSize: "1rem",
                        }}
                      >
                        ${total.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button
                onClick={() => setStep("block")}
                style={{
                  background: "white",
                  border: "1px solid #e2e8f0",
                  borderRadius: "10px",
                  padding: "12px 24px",
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "#475569",
                }}
              >
                ← Назад
              </button>
              <button
                onClick={handleGenerateBlock}
                disabled={loading}
                style={{
                  background: "#16a34a",
                  color: "white",
                  border: "none",
                  borderRadius: "10px",
                  padding: "14px 32px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: "1rem",
                }}
              >
                {loading ? "Генерация..." : " Сгенерировать шахматку"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
