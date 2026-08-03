"use client";

import React, { useState, useRef, useEffect } from "react";
import styles from "./Contracts.module.css";
import {
  createTemplate,
  createContractDraft,
  updateContractStatus,
  generateContractHtml,
  getContractHistory,
  addContractComment,
} from "@/app/actions/contracts";
import { canManageContracts, canApproveContracts, canCommentContracts, canViewAllContracts, isReadOnly, UserRole } from "@/lib/roles";

interface ContractsClientProps {
  initialTemplates: any[];
  initialContracts: any[];
  deals: any[];
  organizationId: string;
  userRole?: string;
  managerId?: string;
}

export default function ContractsClient({
  initialTemplates,
  initialContracts,
  deals,
  organizationId,
  userRole = 'manager',
  managerId = '',
}: ContractsClientProps) {
  const role = userRole as UserRole;
  const canManage = canManageContracts(role);
  const canApprove = canApproveContracts(role);
  const canComment = canCommentContracts(role);
  const canViewAll = canViewAllContracts(role);
  const readOnly = isReadOnly(role);

  // Менеджер видит ТОЛЬКО свои договора — строго, без исключений для несвязанных
  const visibleContracts = canViewAll
    ? initialContracts
    : initialContracts.filter(c => c.managerId === managerId);
  const [activeTab, setActiveTab] = useState<"contracts" | "templates">(
    "contracts",
  );
  const [templates, setTemplates] = useState(initialTemplates);
  const [contracts, setContracts] = useState(visibleContracts);
  const [contractHistory, setContractHistory] = useState<any[]>([]);

  // Состояния для модальных окон
  const [showCreateContractModal, setShowCreateContractModal] = useState(false);
  const [showCreateTemplateModal, setShowCreateTemplateModal] = useState(false);
  const [selectedContract, setSelectedContract] = useState<any | null>(null);
  const [generatedHtml, setGeneratedHtml] = useState<string>("");
  const [selectedTemplate, setSelectedTemplate] = useState<any | null>(null);

  // Состояния форм
  const [newContract, setNewContract] = useState({
    dealId: "",
    templateId: "",
    currencyFixation: "USD",
  });

  const [newTemplate, setNewTemplate] = useState({
    name: "",
    type: "BOOKING",
    language: "ru",
    version: "1.0.0",
    content: "",
  });

  const [scanUrlInput, setScanUrlInput] = useState("");
  const [showScanInput, setShowScanInput] = useState(false);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [loading, setLoading] = useState(false);

  const [isHtmlMode, setIsHtmlMode] = useState(false);
  const [editorInitialized, setEditorInitialized] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      showCreateTemplateModal &&
      !isHtmlMode &&
      editorRef.current &&
      !editorInitialized
    ) {
      editorRef.current.innerHTML = newTemplate.content;
      setEditorInitialized(true);
    }
  }, [
    showCreateTemplateModal,
    isHtmlMode,
    editorInitialized,
    newTemplate.content,
  ]);

  const openTemplateModal = () => {
    setNewTemplate({
      name: "",
      type: "BOOKING",
      language: "ru",
      version: "1.0.0",
      content: "",
    });
    setEditorInitialized(false);
    setIsHtmlMode(false);
    setShowCreateTemplateModal(true);
  };

  const runCommand = (command: string, value: string = "") => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      setNewTemplate((prev) => ({
        ...prev,
        content: editorRef.current?.innerHTML || "",
      }));
    }
  };

  const insertPlaceholder = (tag: string) => {
    if (!tag) return;
    if (isHtmlMode) {
      setNewTemplate((prev) => ({
        ...prev,
        content: prev.content + tag,
      }));
    } else {
      if (editorRef.current) {
        editorRef.current.focus();
        const sel = window.getSelection();
        if (sel && sel.getRangeAt && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const textNode = document.createTextNode(tag);
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.setEndAfter(textNode);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          editorRef.current.innerHTML += tag;
        }
        setNewTemplate((prev) => ({
          ...prev,
          content: editorRef.current?.innerHTML || "",
        }));
      }
    }
  };
  const handleDownloadPdf = () => {
    if (!selectedContract) return;
    const opt = {
      margin: 15,
      filename: `Договор_${selectedContract.documentNumber}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    };

    const runHtml2pdf = () => {
      const element = document.createElement("div");
      element.innerHTML = generatedHtml;
      element.style.padding = "20px";
      element.style.fontFamily = "Arial, sans-serif";
      // @ts-ignore
      window.html2pdf().from(element).set(opt).save();
    };

    // @ts-ignore
    if (window.html2pdf) {
      runHtml2pdf();
    } else {
      const script = document.createElement("script");
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
      script.onload = () => {
        runHtml2pdf();
      };
      document.body.appendChild(script);
    }
  };

  const handleDownloadWord = () => {
    if (!selectedContract) return;
    // Открываем API роут для скачивания Word — браузер автоматически запустит загрузку
    window.location.href = `/api/contracts/${selectedContract.id}/download-word`;
  };

  // Создание заявки на договор
  const handleCreateContract = async () => {
    if (!newContract.dealId || !newContract.templateId) {
      alert("Пожалуйста, выберите сделку и шаблон договора!");
      return;
    }
    setLoading(true);
    const res = await createContractDraft({
      dealId: newContract.dealId,
      templateId: newContract.templateId,
      currencyFixation: newContract.currencyFixation,
      organizationId,
    });
    setLoading(false);
    if (res.success) {
      alert(" Заявка на договор успешно создана!");
      setShowCreateContractModal(false);
      // Обновляем список локально
      window.location.reload();
    } else {
      alert(" Ошибка: " + res.error);
    }
  };

  const handleCreateTemplate = async () => {
    let finalContent = newTemplate.content;
    if (!isHtmlMode && editorRef.current) {
      finalContent = editorRef.current.innerHTML;
    }

    if (!newTemplate.name || !finalContent) {
      alert("Пожалуйста, укажите название и текст шаблона!");
      return;
    }
    setLoading(true);
    const res = await createTemplate({
      ...newTemplate,
      content: finalContent,
      organizationId,
    });
    setLoading(false);
    if (res.success) {
      alert(" Шаблон успешно добавлен!");
      setShowCreateTemplateModal(false);
      window.location.reload();
    } else {
      alert(" Ошибка: " + res.error);
    }
  };

  // Изменение статуса
  const handleStatusChange = async (status: string, scanUrl?: string) => {
    if (!selectedContract) return;
    setLoading(true);
    const res = await updateContractStatus({
      contractId: selectedContract.id,
      status,
      scanUrl,
      organizationId,
    });
    setLoading(false);
    if (res.success) {
      alert(` Статус договора успешно изменен на "${status}"!`);
      setShowScanInput(false);
      // Обновляем просмотр и историю
      const [updatedHtml, historyRes] = await Promise.all([
        generateContractHtml(selectedContract.id),
        getContractHistory(selectedContract.id),
      ]);
      setGeneratedHtml(updatedHtml);
      setContractHistory(historyRes.history || []);
      setSelectedContract({
        ...selectedContract,
        status,
        scanUrl: scanUrl || selectedContract.scanUrl,
      });
      // Обновляем список локально
      window.location.reload();
    } else {
      alert(" Ошибка: " + res.error);
    }
  };

  const ROLE_TRANSLATIONS: Record<string, string> = {
  lawyer: 'юрист',
  manager: 'менеджер',
  admin: 'администратор',
  rop: 'руководитель ОП',
  // другие роли при необходимости
};

  // Открытие просмотра договора
  const handleOpenDetails = async (contract: any) => {
    setLoading(true);
    fetch("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionName: `Пользователь открыл для просмотра договор №${contract.documentNumber}`,
        details: {
          contractId: contract.id,
          client: contract.clientName,
          unit: contract.unitNumber,
        },
      }),
    }).catch(() => {});
    const [html, historyRes] = await Promise.all([
      generateContractHtml(contract.id),
      getContractHistory(contract.id),
    ]);
    setGeneratedHtml(html);
    setContractHistory(historyRes.history || []);
    setSelectedContract(contract);
    setLoading(false);
  };

  // Печать договора
  const handlePrintContract = () => {
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(`
 <html>
 <head>
 <title>Печать договора ${selectedContract?.documentNumber}</title>
 <style>
 body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
 @media print {
 body { padding: 0; }
 .no-print { display: none; }
 }
 </style>
 </head>
 <body>
 <div>${generatedHtml}</div>
 <script>
 window.onload = function() {
 window.print();
 window.close();
 }
 </script>
 </body>
 </html>
 `);
      printWindow.document.close();
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.headerTitle}> Документооборот и договоры</h1>
        <div className={styles.actionButtons}>
          {canManage && (
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => setShowCreateContractModal(true)}
            >
              Создать договор
            </button>
          )}
          {canManage && (
            <button
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={openTemplateModal}
            >
              Новый шаблон
            </button>
          )}
        </div>
      </div>

      {/* Переключение вкладок */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tabButton} ${activeTab === "contracts" ? styles.activeTab : ""}`}
          onClick={() => setActiveTab("contracts")}
        >
          Договоры и Заявки ({contracts.length})
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "templates" ? styles.activeTab : ""}`}
          onClick={() => setActiveTab("templates")}
        >
          Шаблоны документов ({templates.length})
        </button>
      </div>

      {/* Содержимое вкладок */}
      {activeTab === "contracts" ? (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Номер договора</th>
                <th className={styles.th}>Клиент</th>
                <th className={styles.th}>Проект / Объект</th>
                <th className={styles.th}>Тип документа</th>
                <th className={styles.th}>Статус</th>
                <th className={styles.th}>Дата создания</th>
              </tr>
            </thead>
            <tbody>
              {contracts.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className={styles.td}
                    style={{
                      textAlign: "center",
                      padding: "30px",
                      color: "#94a3b8",
                    }}
                  >
                    Нет созданных договоров. Нажмите «Создать договор», чтобы
                    начать.
                  </td>
                </tr>
              ) : (
                contracts.map((c) => (
                  <tr
                    key={c.id}
                    className={styles.tr}
                    onClick={() => handleOpenDetails(c)}
                  >
                    <td className={styles.td} style={{ fontWeight: 700 }}>
                      {c.documentNumber}
                    </td>
                    <td className={styles.td}>{c.clientName}</td>
                    <td className={styles.td}>
                      <span
                        style={{
                          fontSize: "0.8rem",
                          color: "#64748b",
                          display: "block",
                        }}
                      >
                        {c.projectName}
                      </span>
                      Квартира №{c.unitNumber}
                    </td>
                    <td className={styles.td}>
                      <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                        {c.templateType === "BOOKING"
                          ? "Договор бронирования"
                          : c.templateType === "LOI"
                            ? "Договор о намерениях"
                            : c.templateType === "PRELIMINARY"
                              ? "Предварительный ДКП"
                              : "Основной ДКП"}
                      </span>
                    </td>
                    <td className={styles.td}>
                      <span
                        className={`${styles.statusBadge} ${styles["status" + c.status]}`}
                      >
                        {c.status === "DRAFT"
                          ? "Черновик"
                          : c.status === "UNDER_REVIEW"
                            ? "Согласование"
                            : c.status === "CLARIFICATION"
                              ? "На уточнении"
                              : c.status === "APPROVED"
                                ? "Утвержден"
                                : c.status === "SIGNED_PAPER"
                                  ? "Подписан (Бумага)"
                                  : c.status === "SIGNED_EID"
                                    ? "Подписан (eID)"
                                    : c.status === "REJECTED"
                                      ? "Отклонен"
                                      : c.status}
                      </span>
                    </td>
                    <td className={styles.td}>
                      {new Date(c.createdAt).toLocaleDateString("ru-RU")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Название шаблона</th>
                <th className={styles.th}>Тип договора</th>
                <th className={styles.th}>Язык</th>
                <th className={styles.th}>Версия</th>
                <th className={styles.th}>Дата создания</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr
                  key={t.id}
                  className={styles.tr}
                  onClick={() => setSelectedTemplate(t)}
                  style={{ cursor: "pointer" }}
                >
                  <td className={styles.td} style={{ fontWeight: 700 }}>
                    {t.name}
                  </td>
                  <td className={styles.td}>
                    {t.type === "BOOKING"
                      ? "Договор бронирования"
                      : t.type === "LOI"
                        ? "Договор о намерениях"
                        : t.type === "PRELIMINARY"
                          ? "Предварительный ДКП"
                          : "Основной ДКП"}
                  </td>
                  <td
                    className={styles.td}
                    style={{ textTransform: "uppercase" }}
                  >
                    {t.language}
                  </td>
                  <td className={styles.td}>{t.version}</td>
                  <td className={styles.td}>
                    {new Date(t.createdAt).toLocaleDateString("ru-RU")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Модалка создания договора */}
      {showCreateContractModal && (
        <div
          className={styles.modalOverlay}
          onClick={() => setShowCreateContractModal(false)}
        >
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2> Новая заявка на договор (Draft)</h2>
              <button
                className={styles.closeBtn}
                onClick={() => setShowCreateContractModal(false)}
              ></button>
            </div>
            <div className={styles.formGroup}>
              <label>Выберите сделку (клиент и квартира) *</label>
              <select
                className={styles.select}
                value={newContract.dealId}
                onChange={(e) =>
                  setNewContract({ ...newContract, dealId: e.target.value })
                }
              >
                <option value="">Выберите активную сделку...</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.clientName} — {d.projectName}, Кв. №{d.unitNumber} ($
                    {new Intl.NumberFormat().format(d.totalAmount)})
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label>Выберите шаблон договора *</label>
              <select
                className={styles.select}
                value={newContract.templateId}
                onChange={(e) =>
                  setNewContract({ ...newContract, templateId: e.target.value })
                }
              >
                <option value="">Выберите шаблон...</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (v{t.version})
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label>Фиксация валюты в договоре</label>
              <select
                className={styles.select}
                value={newContract.currencyFixation}
                onChange={(e) =>
                  setNewContract({
                    ...newContract,
                    currencyFixation: e.target.value,
                  })
                }
              >
                <option value="USD">
                  Сумма в USD (Валютный риск застройщика)
                </option>
                <option value="GEL">Сумма в GEL (Валютный риск клиента)</option>
              </select>
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.btnSecondary}
                onClick={() => setShowCreateContractModal(false)}
              >
                Отмена
              </button>
              <button
                className={styles.btnPrimary}
                onClick={handleCreateContract}
                disabled={loading}
              >
                Создать заявку
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка создания шаблона */}
      {showCreateTemplateModal && (
        <div
          className={styles.modalOverlay}
          onClick={() => setShowCreateTemplateModal(false)}
        >
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "800px" }}
          >
            <div className={styles.modalHeader}>
              <h2> Создание нового шаблона документов</h2>
              <button
                className={styles.closeBtn}
                onClick={() => setShowCreateTemplateModal(false)}
              ></button>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label>Название шаблона *</label>
                <input
                  className={styles.input}
                  placeholder="Например: Договор бронирования ЖК Park Boulevard"
                  value={newTemplate.name}
                  onChange={(e) =>
                    setNewTemplate({ ...newTemplate, name: e.target.value })
                  }
                />
              </div>
              <div className={styles.formGroup}>
                <label>Тип договора</label>
                <select
                  className={styles.select}
                  value={newTemplate.type}
                  onChange={(e) =>
                    setNewTemplate({ ...newTemplate, type: e.target.value })
                  }
                >
                  <option value="LOI">Letter of Intent (О намерениях)</option>
                  <option value="BOOKING">
                    Booking Agreement (Бронирование)
                  </option>
                  <option value="PRELIMINARY">
                    Preliminary Sale-Purchase (Предварительный)
                  </option>
                  <option value="SALE_PURCHASE">
                    Sale-Purchase (Основной ДКП)
                  </option>
                </select>
              </div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label>Язык шаблона</label>
                <select
                  className={styles.select}
                  value={newTemplate.language}
                  onChange={(e) =>
                    setNewTemplate({ ...newTemplate, language: e.target.value })
                  }
                >
                  <option value="ru">Русский</option>
                  <option value="ka">Грузинский (ქართული)</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label>Версия шаблона</label>
                <input
                  className={styles.input}
                  placeholder="1.0.0"
                  value={newTemplate.version}
                  onChange={(e) =>
                    setNewTemplate({ ...newTemplate, version: e.target.value })
                  }
                />
              </div>
            </div>
            <div className={styles.formGroup}>
              <label>
                Доступные теги автоподстановки (скопируйте и вставьте в текст):
              </label>
              <div className={styles.placeholderList}>
                <div>
                  Клиент: <code>{"{{client.fullName}}"}</code>
                </div>
                <div>
                  Паспорт: <code>{"{{client.passport}}"}</code>
                </div>
                <div>
                  Квартира №: <code>{"{{unit.number}}"}</code>
                </div>
                <div>
                  Площадь: <code>{"{{unit.totalArea}}"}</code>
                </div>
                <div>
                  Цена сделки: <code>{"{{deal.priceUsd}}"}</code>
                </div>
                <div>
                  Валюта договора: <code>{"{{contract.currency}}"}</code>
                </div>
              </div>
            </div>
            <div className={styles.formGroup}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <label style={{ margin: 0 }}>Текст шаблона договора *</label>
                <button
                  type="button"
                  className={styles.toolbarBtn}
                  onClick={() => {
                    if (!isHtmlMode && editorRef.current) {
                      setNewTemplate((prev) => ({
                        ...prev,
                        content: editorRef.current?.innerHTML || "",
                      }));
                    }
                    setIsHtmlMode(!isHtmlMode);
                    setEditorInitialized(false);
                  }}
                  style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                >
                  {isHtmlMode ? " Визуальный редактор" : " Редактировать HTML"}
                </button>
              </div>

              {!isHtmlMode ? (
                <div className={styles.editorContainer}>
                  <div className={styles.editorToolbar}>
                    <button
                      type="button"
                      className={styles.toolbarBtn}
                      onClick={() => runCommand("bold")}
                      title="Жирный"
                    >
                      <b>B</b>
                    </button>
                    <button
                      type="button"
                      className={styles.toolbarBtn}
                      onClick={() => runCommand("italic")}
                      title="Курсив"
                    >
                      <i>I</i>
                    </button>
                    <button
                      type="button"
                      className={styles.toolbarBtn}
                      onClick={() => runCommand("underline")}
                      title="Подчеркнутый"
                    >
                      <u>U</u>
                    </button>
                    <span style={{ color: "#cbd5e1", margin: "0 4px" }}>|</span>
                    <button
                      type="button"
                      className={styles.toolbarBtn}
                      onClick={() => runCommand("justifyLeft")}
                      title="По левому краю"
                    ></button>
                    <button
                      type="button"
                      className={styles.toolbarBtn}
                      onClick={() => runCommand("justifyCenter")}
                      title="По центру"
                    ></button>
                    <button
                      type="button"
                      className={styles.toolbarBtn}
                      onClick={() => runCommand("justifyRight")}
                      title="По правому краю"
                    ></button>
                    <span style={{ color: "#cbd5e1", margin: "0 4px" }}>|</span>
                    <select
                      className={styles.toolbarSelect}
                      onChange={(e) =>
                        runCommand("formatBlock", e.target.value)
                      }
                      defaultValue="P"
                    >
                      <option value="P">Обычный текст</option>
                      <option value="H2">Заголовок</option>
                    </select>
                    <span style={{ color: "#cbd5e1", margin: "0 4px" }}>|</span>
                    <select
                      className={styles.toolbarSelect}
                      onChange={(e) => {
                        insertPlaceholder(e.target.value);
                        e.target.value = "";
                      }}
                      defaultValue=""
                    >
                      <option value="" disabled>
                        {" "}
                        Вставить переменную...
                      </option>
                      <optgroup label="Клиент">
                        <option value="{{client.fullName}}">ФИО клиента</option>
                        <option value="{{client.phone}}">Телефон</option>
                        <option value="{{client.email}}">Email</option>
                        <option value="{{client.passport}}">Паспорт/ИИН</option>
                        <option value="{{client.personalNumber}}">
                          Личный номер
                        </option>
                        <option value="{{client.address}}">
                          Адрес клиента
                        </option>
                      </optgroup>
                      <optgroup label="Квартира">
                        <option value="{{unit.number}}">Номер квартиры</option>
                        <option value="{{unit.floor}}">Этаж</option>
                        <option value="{{unit.totalArea}}">Площадь</option>
                        <option value="{{building.name}}">Название ЖК</option>
                      </optgroup>
                      <optgroup label="Сделка">
                        <option value="{{deal.priceUsd}}">Цена в USD</option>
                        <option value="{{contract.currency}}">
                          Валюта договора
                        </option>
                        <option value="{{booking.deposit}}">
                          Резерв. депозит
                        </option>
                      </optgroup>
                      <optgroup label="Застройщик">
                        <option value="{{seller.companyName}}">
                          Название компании
                        </option>
                        <option value="{{seller.tin}}">ИНН компании</option>
                        <option value="{{seller.bankAccount}}">
                          Банковский счет
                        </option>
                      </optgroup>
                      <optgroup label="Системные">
                        <option value="{{now.date}}">Текущая дата</option>
                        <option value="{{document.number}}">
                          Номер договора
                        </option>
                      </optgroup>
                    </select>
                  </div>
                  <div
                    ref={editorRef}
                    className={styles.editorArea}
                    contentEditable={true}
                    onBlur={() => {
                      if (editorRef.current) {
                        setNewTemplate((prev) => ({
                          ...prev,
                          content: editorRef.current?.innerHTML || "",
                        }));
                      }
                    }}
                    suppressContentEditableWarning={true}
                  />
                </div>
              ) : (
                <textarea
                  className={styles.textarea}
                  rows={12}
                  placeholder="Напишите HTML-код шаблона договора..."
                  value={newTemplate.content}
                  onChange={(e) =>
                    setNewTemplate({ ...newTemplate, content: e.target.value })
                  }
                />
              )}
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.btnSecondary}
                onClick={() => setShowCreateTemplateModal(false)}
              >
                Отмена
              </button>
              <button
                className={styles.btnPrimary}
                onClick={handleCreateTemplate}
                disabled={loading}
              >
                Опубликовать
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка просмотра и согласования договора */}
      {selectedContract && (
        <div
          className={styles.modalOverlay}
          onClick={() => setSelectedContract(null)}
        >
          <div
            className={`${styles.modalContent} ${styles.modalFullScreen}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2>Карточка договора {selectedContract.documentNumber}</h2>
              <button
                className={styles.closeBtn}
                onClick={() => setSelectedContract(null)}
              ></button>
            </div>

            <div className={styles.detailsGrid}>
              {/* Лист А4 предпросмотра */}
              <div className={styles.paper}>
                <div dangerouslySetInnerHTML={{ __html: generatedHtml }} />
              </div>

              {/* Панель управления и согласования */}
              <div>
                <div className={styles.sidebarCard}>
                  <h3>Статус и Метаданные</h3>
                  <div className={styles.metaRow}>
                    <span>Номер:</span>
                    <span>{selectedContract.documentNumber}</span>
                  </div>
                  <div className={styles.metaRow}>
                    <span>Статус:</span>
                    <span
                      className={`${styles.statusBadge} ${styles["status" + selectedContract.status]}`}
                    >
                      {selectedContract.status === "DRAFT"
                        ? "Черновик"
                        : selectedContract.status === "UNDER_REVIEW"
                          ? "Согласование"
                          : selectedContract.status === "CLARIFICATION"
                            ? "На уточнении"
                            : selectedContract.status === "APPROVED"
                              ? "Утвержден"
                              : selectedContract.status === "SIGNED_PAPER"
                                ? "Подписан (Бумага)"
                                : selectedContract.status === "SIGNED_EID"
                                  ? "Подписан (eID)"
                                  : selectedContract.status === "REJECTED"
                                    ? "Отклонен"
                                    : selectedContract.status}
                    </span>
                  </div>
                  <div className={styles.metaRow}>
                    <span>Фиксация валюты:</span>
                    <span>Сумма в {selectedContract.currencyFixation}</span>
                  </div>
                  <div className={styles.metaRow}>
                    <span>Сделка:</span>
                    <span>
                      $
                      {new Intl.NumberFormat().format(
                        selectedContract.dealAmount,
                      )}
                    </span>
                  </div>
                  <div className={styles.metaRow}>
                    <span>Покупатель:</span>
                    <span>{selectedContract.clientName}</span>
                  </div>
                  <div className={styles.metaRow}>
                    <span>Объект:</span>
                    <span>Квартира №{selectedContract.unitNumber}</span>
                  </div>
                </div>

                <div className={styles.sidebarCard}>
                  <h3>История изменений</h3>
                  <div
                    style={{
                      maxHeight: "180px",
                      overflowY: "auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    {contractHistory.length === 0 ? (
                      <span
                        style={{
                          fontSize: "0.85rem",
                          color: "#64748b",
                          fontStyle: "italic",
                        }}
                      >
                        История изменений пуста
                      </span>
                    ) : (
                      contractHistory.map((item: any) => (
                        <div
                          key={item.id}
                          style={{
                            fontSize: "0.8rem",
                            borderBottom: "1px solid #f1f5f9",
                            paddingBottom: "6px",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              color: "#64748b",
                              marginBottom: "2px",
                            }}
                          >
                            <span>
                              <strong>{item.managerName}</strong>
                            </span>
                            <span>
                              {new Date(item.createdAt).toLocaleString(
                                "ru-RU",
                                {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )}
                            </span>
                          </div>
                          <div style={{ color: "#334155" }}>
                            {item.action === "CREATE" ? (
                              <span
                                style={{ color: "#0d9488", fontWeight: 600 }}
                              >
                                Создан черновик
                              </span>
                            ) : item.action === "CONTRACT_COMMENT" ? (
                              <div>
                                <span style={{ color: "#b45309", fontWeight: 700 }}>
                                   Уточнение{item.reason ? ` (${ROLE_TRANSLATIONS[item.reason.replace('Роль: ', '')] || item.reason.replace('Роль: ', '')})` : ''}:
                                </span>
                                <div style={{ marginTop: "4px", padding: "8px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "6px", whiteSpace: "pre-wrap" }}>
                                  {item.newValue}
                                </div>
                              </div>
                            ) : (
                              <span>
                                Изменение статуса:{" "}
                                <span
                                  style={{
                                    textDecoration: "line-through",
                                    color: "#94a3b8",
                                  }}
                                >
                                  {item.oldValue}
                                </span>{" "}
                                →{" "}
                                <strong style={{ color: "#2563eb" }}>
                                  {item.newValue}
                                </strong>
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className={styles.sidebarCard}>
                  <h3>Действия по согласованию</h3>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    {/* Кнопки для Черновика */}
                    {selectedContract.status === "DRAFT" && canManage && (
                      <button
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        onClick={() => handleStatusChange("UNDER_REVIEW")}
                        disabled={loading}
                      >
                        Отправить на согласование
                      </button>
                    )}

                    {/* Кнопки для Согласования — утверждение/отклонение только для РОП/админа */}
                    {selectedContract.status === "UNDER_REVIEW" && canApprove && (
                      <>
                        <button
                          className={`${styles.btn} ${styles.btnSuccess}`}
                          onClick={() => handleStatusChange("APPROVED")}
                          disabled={loading}
                        >
                          Утвердить коммерческие условия
                        </button>
                        <button
                          className={`${styles.btn} ${styles.btnDanger}`}
                          onClick={() => handleStatusChange("REJECTED")}
                          disabled={loading}
                        >
                          Отклонить договор
                        </button>
                      </>
                    )}
                    {selectedContract.status === "UNDER_REVIEW" && !canApprove && (
                      <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: 0 }}>
                        Ожидает согласования руководителем ОП или админом.
                      </p>
                    )}

                    {/* Договор на уточнении у юриста — вернуть на повторное согласование */}
                    {selectedContract.status === "CLARIFICATION" && canManage && (
                      <button
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        onClick={() => handleStatusChange("UNDER_REVIEW")}
                        disabled={loading}
                      >
                        Вернуть на согласование после уточнения
                      </button>
                    )}

                    {/* Кнопки для Утвержденного */}
                    {selectedContract.status === "APPROVED" && canManage && (
                      <>
                        <button
                          className={`${styles.btn} ${styles.btnSuccess}`}
                          onClick={() => setShowScanInput(true)}
                          disabled={loading}
                        >
                          Зарегистрировать бумажную подпись
                        </button>
                        <button
                          className={`${styles.btn} ${styles.btnPrimary}`}
                          onClick={() => handleStatusChange("SIGNED_EID")}
                          disabled={loading}
                        >
                          Имитировать eID подпись (my.gov.ge)
                        </button>
                      </>
                    )}

                    {/* Кнопка "Уточнить" — для юриста и всех кто может комментировать */}
                    {canComment && (
                      <button
                        className={`${styles.btn} ${styles.btnSecondary}`}
                        onClick={() => setShowCommentInput(!showCommentInput)}
                      >
                        Уточнить
                      </button>
                    )}

                    {/* Поле комментария */}
                    {showCommentInput && canComment && (
                      <div style={{ marginTop: '12px', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <label style={{ display: 'block', fontWeight: 600, marginBottom: '8px', fontSize: '0.85rem', color: '#475569' }}>
                          Комментарий / уточнение:
                        </label>
                        <textarea
                          value={commentText}
                          onChange={e => setCommentText(e.target.value)}
                          placeholder="Введите комментарий или вопрос по договору..."
                          style={{ width: '100%', minHeight: '80px', padding: '8px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.85rem', resize: 'vertical' }}
                        />
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', justifyContent: 'flex-end' }}>
                          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => { setShowCommentInput(false); setCommentText(''); }}>
                            Отмена
                          </button>
                          <button
                            className={`${styles.btn} ${styles.btnPrimary}`}
                            disabled={!commentText.trim() || loading}
                            onClick={async () => {
                              if (!commentText.trim()) return;
                              setLoading(true);
                              await addContractComment({
                                contractId: selectedContract.id,
                                comment: commentText,
                                authorRole: role,
                                managerId,
                                organizationId
                              });
                              setLoading(false);
                              setShowCommentInput(false);
                              setCommentText('');
                              // Обновляем историю
                              const historyRes = await getContractHistory(selectedContract.id);
                              setContractHistory(historyRes.history || []);
                            }}
                          >
                            Отправить
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Поле для ввода скана */}
                    {showScanInput && (
                      <div
                        style={{
                          background: "#ffffff",
                          border: "1px solid #cbd5e1",
                          padding: "12px",
                          borderRadius: "8px",
                          marginTop: "10px",
                        }}
                      >
                        <label
                          style={{
                            display: "block",
                            fontSize: "0.8rem",
                            fontWeight: "bold",
                            marginBottom: "6px",
                          }}
                        >
                          Ссылка на скан подписанного договора (URL):
                        </label>
                        <input
                          className={styles.input}
                          placeholder="https://example.com/scan.pdf"
                          value={scanUrlInput}
                          onChange={(e) => setScanUrlInput(e.target.value)}
                          style={{ marginBottom: "10px" }}
                        />
                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            justifyContent: "flex-end",
                          }}
                        >
                          <button
                            className={styles.btnSecondary}
                            style={{ padding: "6px 12px", fontSize: "0.8rem" }}
                            onClick={() => setShowScanInput(false)}
                          >
                            Отмена
                          </button>
                          <button
                            className={styles.btnSuccess}
                            style={{ padding: "6px 12px", fontSize: "0.8rem" }}
                            onClick={() =>
                              handleStatusChange("SIGNED_PAPER", scanUrlInput)
                            }
                          >
                            Подписать
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Скачивание */}
                    <div
                      style={{ display: "flex", gap: "8px", marginTop: "10px" }}
                    >
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSecondary}`}
                        onClick={handleDownloadWord}
                        style={{
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                        }}
                      >
                        Скачать Word
                      </button>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        onClick={handleDownloadPdf}
                        style={{
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                        }}
                      >
                        PDF
                      </button>
                    </div>

                    <button
                      className={`${styles.btn} ${styles.btnSecondary}`}
                      onClick={() => setSelectedContract(null)}
                    >
                      Закрыть окно
                    </button>
                  </div>
                </div>

                {selectedContract.scanUrl && (
                  <div className={styles.sidebarCard}>
                    <h3>Скан-копия документа</h3>
                    <a
                      href={selectedContract.scanUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "#2563eb",
                        fontWeight: "bold",
                        fontSize: "0.85rem",
                        textDecoration: "underline",
                      }}
                    >
                      Открыть прикрепленный скан
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Модалка просмотра шаблона */}
      {selectedTemplate && (
        <div
          className={styles.modalOverlay}
          onClick={() => setSelectedTemplate(null)}
        >
          <div
            className={`${styles.modalContent} ${styles.modalLarge}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2>Просмотр шаблона: {selectedTemplate.name}</h2>
              <button
                className={styles.closeBtn}
                onClick={() => setSelectedTemplate(null)}
              ></button>
            </div>
            <div
              className={styles.paper}
              style={{ maxHeight: "70vh", overflowY: "auto" }}
            >
              <div
                dangerouslySetInnerHTML={{ __html: selectedTemplate.content }}
              />
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.btnSecondary}
                onClick={() => setSelectedTemplate(null)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}