"use client";

import React, { useState } from "react";
import styles from "./LeadModal.module.css";
import { createClient } from "@/app/actions/leads";

interface LeadModalProps {
  onClose: () => void;
  onSuccess: () => void;
  organizationId: string;
  onSelectExisting?: (id: string) => void;
  onCreated?: (id: string, name: string, phone: string) => void;
}

type ClientType = "RESIDENT_GE" | "NON_RESIDENT" | "LEGAL_ENTITY";

const LeadModal: React.FC<LeadModalProps> = ({
  onClose,
  onSuccess,
  organizationId,
  onSelectExisting,
  onCreated,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; link?: string } | null>(
    null,
  );
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    iin: "",
    source: "Instagram",
    type: "RESIDENT_GE" as ClientType,
    personalNumber: "",
    passportNumber: "",
    passportCountry: "",
    consentToPdProcessing: false,
    optInMarketing: false,
    codeWord: "", // новое поле
  });

  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.name.trim()) errors.name = "Введите имя клиента";
    if (!formData.phone.trim()) errors.phone = "Введите номер телефона";

    // Personal Number: 11 цифр для резидентов Грузии
    if (formData.type === "RESIDENT_GE") {
      if (!formData.personalNumber.trim()) {
        errors.personalNumber =
          "Personal Number обязателен для резидентов Грузии";
      } else if (!/^\d{11}$/.test(formData.personalNumber.trim())) {
        errors.personalNumber =
          "Personal Number должен содержать ровно 11 цифр";
      }
    }

    // Паспорт для нерезидентов
    if (formData.type === "NON_RESIDENT") {
      if (!formData.passportNumber.trim()) {
        errors.passportNumber = "Номер паспорта обязателен для нерезидентов";
      }
      if (!formData.passportCountry.trim()) {
        errors.passportCountry = "Укажите страну гражданства";
      }
    }

    // Согласие на обработку ПД обязательно
    if (!formData.consentToPdProcessing) {
      errors.consent = "Необходимо согласие на обработку персональных данных";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setError(null);

    const res = await createClient({
      ...formData,
      organizationId: organizationId,
      createdById: organizationId,
      codeWord: formData.codeWord, // ДОБАВЛЯЕМ
    });

    if (res.success) {
      if (onCreated && res.client) {
        // Если вызвано из сделки — передаём данные нового клиента обратно
        onCreated(res.client.id, formData.name, formData.phone);
      } else {
        onSuccess();
      }
      onClose();
    } else if (res.error === "DUPLICATE") {
      setError({
        message: res.message || "Такой клиент уже существует",
        link: res.existingClientId,
      });
    } else {
      setError({ message: "Ошибка при создании клиента" });
    }
    setLoading(false);
  };

  const clientTypeLabels: Record<
    ClientType,
    { label: string; icon: string; desc: string }
  > = {
    RESIDENT_GE: {
      label: "ФЛ – Резидент Грузии",
      icon: "",
      desc: "Personal Number (11 цифр)",
    },
    NON_RESIDENT: {
      label: "ФЛ – Нерезидент",
      icon: "",
      desc: "Паспорт + страна гражданства",
    },
    LEGAL_ENTITY: {
      label: "Юридическое лицо",
      icon: "",
      desc: "ИНН/Код компании",
    },
  };

  // Маскирование телефона при отображении (последние 4 цифры видны)
  const maskPhone = (phone: string) => {
    if (phone.length <= 4) return phone;
    return "•".repeat(phone.length - 4) + phone.slice(-4);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h2>Регистрация нового клиента</h2>
          <button className={styles.closeBtn} onClick={onClose}></button>
        </header>

        {error && (
          <div className={styles.errorAlert}>
            <span>{error.message}</span>
            {error.link && (
              <button
                className={styles.linkBtn}
                onClick={() => onSelectExisting?.(error.link as string)}
              >
                Перейти
              </button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.form}>
          {/* === Тип клиента === */}
          <div className={styles.fullWidth}>
            <label className={styles.sectionLabel}>Тип клиента</label>
            <div className={styles.typeSelector}>
              {(Object.keys(clientTypeLabels) as ClientType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`${styles.typeCard} ${formData.type === type ? styles.typeCardActive : ""}`}
                  onClick={() =>
                    setFormData({
                      ...formData,
                      type,
                      personalNumber: "",
                      passportNumber: "",
                      passportCountry: "",
                    })
                  }
                >
                  <span className={styles.typeIcon}>
                    {clientTypeLabels[type].icon}
                  </span>
                  <span className={styles.typeLabel}>
                    {clientTypeLabels[type].label}
                  </span>
                  <span className={styles.typeDesc}>
                    {clientTypeLabels[type].desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* === ФИО === */}
          <div className={styles.group}>
            <label>Полное имя клиента</label>
            <input
              type="text"
              required
              placeholder="ФИО"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className={validationErrors.name ? styles.inputError : ""}
            />
            {validationErrors.name && (
              <span className={styles.fieldError}>{validationErrors.name}</span>
            )}
          </div>

          {/* === Телефон === */}
          <div className={styles.group}>
            <label>Телефон</label>
            <input
              type="tel"
              required
              placeholder="+995 или +7"
              value={formData.phone}
              onChange={(e) =>
                setFormData({ ...formData, phone: e.target.value })
              }
              className={validationErrors.phone ? styles.inputError : ""}
            />
            {validationErrors.phone && (
              <span className={styles.fieldError}>
                {validationErrors.phone}
              </span>
            )}
          </div>

          {/* === Email === */}
          <div className={styles.group}>
            <label>Email</label>
            <input
              type="email"
              placeholder="example@mail.com"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
            />
          </div>

          {/* === Поля в зависимости от типа клиента === */}
          {formData.type === "RESIDENT_GE" && (
            <div className={styles.group}>
              <label>
                Personal Number <span className={styles.required}>*</span>
              </label>
              <input
                type="text"
                placeholder="11 цифр"
                maxLength={11}
                value={formData.personalNumber}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  setFormData({ ...formData, personalNumber: val });
                }}
                className={
                  validationErrors.personalNumber ? styles.inputError : ""
                }
              />
              {validationErrors.personalNumber && (
                <span className={styles.fieldError}>
                  {validationErrors.personalNumber}
                </span>
              )}
              {formData.personalNumber &&
                formData.personalNumber.length < 11 && (
                  <span className={styles.fieldHint}>
                    {formData.personalNumber.length}/11 цифр
                  </span>
                )}
              {formData.personalNumber.length === 11 && (
                <span className={styles.fieldSuccess}> Формат верный</span>
              )}
            </div>
          )}

          {formData.type === "NON_RESIDENT" && (
            <>
              <div className={styles.group}>
                <label>
                  Номер паспорта <span className={styles.required}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="AB1234567"
                  value={formData.passportNumber}
                  onChange={(e) =>
                    setFormData({ ...formData, passportNumber: e.target.value })
                  }
                  className={
                    validationErrors.passportNumber ? styles.inputError : ""
                  }
                />
                {validationErrors.passportNumber && (
                  <span className={styles.fieldError}>
                    {validationErrors.passportNumber}
                  </span>
                )}
              </div>
              <div className={styles.group}>
                <label>
                  Страна гражданства <span className={styles.required}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="Турция, Россия, Иран..."
                  value={formData.passportCountry}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      passportCountry: e.target.value,
                    })
                  }
                  className={
                    validationErrors.passportCountry ? styles.inputError : ""
                  }
                />
                {validationErrors.passportCountry && (
                  <span className={styles.fieldError}>
                    {validationErrors.passportCountry}
                  </span>
                )}
              </div>
            </>
          )}

          {formData.type === "LEGAL_ENTITY" && (
            <div className={styles.group}>
              <label>ИНН / Identification Code</label>
              <input
                type="text"
                placeholder="Код компании"
                value={formData.iin}
                onChange={(e) =>
                  setFormData({ ...formData, iin: e.target.value })
                }
              />
            </div>
          )}

          {/* === Источник === */}
          <div className={styles.group}>
            <label>Источник обращения</label>
            <select
              value={formData.source}
              onChange={(e) =>
                setFormData({ ...formData, source: e.target.value })
              }
            >
              <option value="Instagram">Instagram</option>
              <option value="Facebook">Facebook</option>
              <option value="Website">Сайт</option>
              <option value="Referral">Рекомендация</option>
              <option value="WalkIn">Walk-in (визит в офис)</option>
              <option value="Other">Другое</option>
            </select>
          </div>

          {/* === PDPS Согласия === */}
          <div className={styles.fullWidth}>
            <div className={styles.consentBlock}>
              <label className={styles.sectionLabel}>
                Согласие на обработку данных
              </label>

              <label
                className={`${styles.checkboxLabel} ${validationErrors.consent ? styles.checkboxError : ""}`}
              >
                <input
                  type="checkbox"
                  checked={formData.consentToPdProcessing}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      consentToPdProcessing: e.target.checked,
                    })
                  }
                />
                <span className={styles.checkmark}></span>
                <span>
                  Клиент даёт согласие на обработку персональных данных{" "}
                  <span className={styles.required}>*</span>
                </span>
              </label>
              {validationErrors.consent && (
                <span className={styles.fieldError}>
                  {validationErrors.consent}
                </span>
              )}

              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={formData.optInMarketing}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      optInMarketing: e.target.checked,
                    })
                  }
                />
                <span className={styles.checkmark}></span>
                <span>Согласие на получение маркетинговых рассылок</span>
              </label>
            </div>
          </div>

          <div className={styles.fullWidth}>
            <div className={styles.group}>
              <label>Кодовое слово</label>
              <input
                type="text"
                placeholder="Секретное слово для идентификации по телефону"
                value={formData.codeWord}
                onChange={(e) =>
                  setFormData({ ...formData, codeWord: e.target.value })
                }
              />
              <span className={styles.fieldHint}>
                Используется для подтверждения личности по телефону без
                раскрытия паспортных данных
              </span>
            </div>
          </div>

          <footer className={styles.footer}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onClose}
            >
              Отмена
            </button>
            <button type="submit" className={styles.saveBtn} disabled={loading}>
              {loading ? "..." : "Создать карту клиента"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};

export default LeadModal;
