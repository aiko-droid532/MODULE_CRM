import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import {
  getFunnelReportData,
  getDealTransitions,
  getProjectSalesReportData,
  getManagerSalesReportData,
  getSalesCashFlowData,
  getPaymentRegistryData,
  getDebtorsRegistryData,
  getCashFlowReportData,
  getManagerKpiData,
  getMarketingChannelsData,
  getProjectsList,
  getManagersList,
  getBlocksList,
  getSourcesList,
  getPaymentTypesList,
  getUnitTypesList,
  getContractDraftsReportData,
  getSalesDynamicsReportData,
  getCohortAnalysisReportData,
  getDiscountReportData,
  getMortgageReportData,
  getTaxInvoiceReportData,
  getEscrowReportData,
  getAvailableUnitsReportData,
  getSoldUnitsReportData,
  getProjectExposureReportData,
  getFreeUnitsSearchData,
  getPriceHistoryReportData,
  getAreaDiscrepancyReportData,
  getVipClientsReportData,
  getClientDossierReportData,
  getBookingReportData
} from '@/app/actions/reports';
import { getExchangeRate } from '@/app/actions/exchange';
import ReportsClient from './ReportsClient';

import { extractRole, canViewReports } from '@/lib/roles';
import { resolveEffectiveRole } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const cookieStore = cookies();
  const token = searchParams.token || cookieStore.get('auth_token')?.value;

  let organizationId = 'default';
  let userRole = 'manager';
  let managerId = '';

  if (token) {
    try {
      const { payload } = await verifyToken(token);
      if (payload && typeof payload !== 'string') {
        console.log('--- REPORTS JWT TOKEN PAYLOAD DEBUG ---');
        console.log(JSON.stringify(payload, null, 2));
        console.log('----------------------------------------');
        organizationId = ((payload as any).app_metadata?.organization_id as string) || '741be209-ad6f-4483-92ee-298a36899bcf';
        userRole = extractRole(payload);
        managerId = (payload.sub as string) || '';
        userRole = await resolveEffectiveRole(userRole as any, managerId);
      }
    } catch (e) {
      console.error('Token verification failed:', e);
    }
  }

  // Проверяем доступ к отчётам
  if (!canViewReports(userRole as any)) {
    const { redirect } = await import('next/navigation');
    redirect('/');
  }

  // Загружаем все данные для отчетов, справочники и курс валют параллельно
  const [
    funnelData,
    dealTransitions,
    projectSales,
    managerSales,
    cashFlow,
    paymentRegistry,
    debtors,
    cashFlowReport,
    managerKpi,
    marketingChannels,
    contractDrafts,
    salesDynamics,
    cohortAnalysis,
    discountReport,
    mortgageReport,
    taxInvoiceReport,
    escrowReport,
    availableUnits,
    soldUnits,
    projectExposure,
    freeUnitsSearch,
    priceHistory,
    areaDiscrepancy,
    vipClients,
    clientDossier,
    bookingReport,
    projects,
    managers,
    blocks,
    sources,
    paymentTypes,
    unitTypes,
    usdRate
  ] = await Promise.all([
    getFunnelReportData(organizationId),
    getDealTransitions(organizationId),
    getProjectSalesReportData(organizationId),
    getManagerSalesReportData(organizationId),
    getSalesCashFlowData(organizationId),
    getPaymentRegistryData(organizationId),
    getDebtorsRegistryData(organizationId),
    getCashFlowReportData(organizationId),
    getManagerKpiData(organizationId),
    getMarketingChannelsData(organizationId),
    getContractDraftsReportData(organizationId),
    getSalesDynamicsReportData(organizationId),
    getCohortAnalysisReportData(organizationId),
    getDiscountReportData(organizationId),
    getMortgageReportData(organizationId),
    getTaxInvoiceReportData(organizationId),
    getEscrowReportData(organizationId),
    getAvailableUnitsReportData(organizationId),
    getSoldUnitsReportData(organizationId),
    getProjectExposureReportData(organizationId),
    getFreeUnitsSearchData(organizationId),
    getPriceHistoryReportData(organizationId),
    getAreaDiscrepancyReportData(organizationId),
    getVipClientsReportData(organizationId),
    getClientDossierReportData(organizationId),
    getBookingReportData(organizationId),
    getProjectsList(organizationId),
    getManagersList(organizationId),
    getBlocksList(organizationId),
    getSourcesList(organizationId),
    getPaymentTypesList(organizationId),
    getUnitTypesList(organizationId),
    getExchangeRate()
  ]);

  return (
    <ReportsClient
      organizationId={organizationId}
      userRole={userRole}
      projects={projects}
      managers={managers}
      blocks={blocks}
      sources={sources}
      paymentTypes={paymentTypes}
      unitTypes={unitTypes}
      usdRate={usdRate}
      initialData={{
        funnelData,
        dealTransitions,
        projectSales,
        managerSales,
        cashFlow,
        paymentRegistry,
        debtors,
        cashFlowReport,
        managerKpi,
        marketingChannels,
        contractDrafts,
        salesDynamics,
        cohortAnalysis,
        discountReport,
        mortgageReport,
        taxInvoiceReport,
        escrowReport,
        availableUnits,
        soldUnits,
        projectExposure,
        freeUnitsSearch,
        priceHistory,
        areaDiscrepancy,
        vipClients,
        clientDossier,
        bookingReport
      }}
    />
  );
}