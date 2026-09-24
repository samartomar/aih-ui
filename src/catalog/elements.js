/*
 * The Sources & Catalogs elements, looked up once and handed to the components
 * that own them. No component looks an element up for itself, and none reaches
 * into another's subtree.
 */

import { collectIds } from "../app/dom.js";

export function catalogElements() {
  const ids = [
    "provenance-strip", "masthead-name", "masthead-version", "masthead-status",
    "nav-sources-count", "rail-scope-list", "framework-matrix-tabs",
    "review-filters", "review-summary",
    "kind-filters", "catalog-search", "source-filter", "sort-select",
    "visible-count", "visible-caption", "category-context", "cards-grid",
    "inspector-name", "inspector-kind", "inspector-version", "inspector-subtitle",
    "inspector-flags", "inspector-icon",
    "details-identity", "details-source", "details-desc", "details-capabilities",
    "details-artifacts", "detector-run-state", "detector-finding-detail",
    "scanner-report-statement", "statement-count", "security-statements",
    "qualification-evaluated", "security-qualification", "qualification-footer",
  ];
  const found = collectIds(ids);
  return {
    provenance: {
      provenanceStrip: found.provenanceStrip,
      mastheadStatus: found.mastheadStatus,
      mastheadName: found.mastheadName,
      mastheadVersion: found.mastheadVersion,
    },
    navigation: {
      navSourcesCount: found.navSourcesCount,
      scopeList: found.railScopeList,
    },
    metrics: { container: found.frameworkMatrixTabs },
    toolbar: {
      reviewFilters: found.reviewFilters,
      reviewSummary: found.reviewSummary,
      kindFilters: found.kindFilters,
      search: found.catalogSearch,
      sourceFilter: found.sourceFilter,
      sortSelect: found.sortSelect,
    },
    cards: {
      cardsGrid: found.cardsGrid,
      visibleCount: found.visibleCount,
      visibleCaption: found.visibleCaption,
      categoryContext: found.categoryContext,
    },
    details: {
      inspectorName: found.inspectorName,
      inspectorKind: found.inspectorKind,
      inspectorVersion: found.inspectorVersion,
      inspectorSubtitle: found.inspectorSubtitle,
      inspectorFlags: found.inspectorFlags,
      inspectorIcon: found.inspectorIcon,
      detailsIdentity: found.detailsIdentity,
      detailsSource: found.detailsSource,
      detailsDesc: found.detailsDesc,
      detailsCapabilities: found.detailsCapabilities,
      detailsArtifacts: found.detailsArtifacts,
      detectorRunState: found.detectorRunState,
      detectorFindingDetail: found.detectorFindingDetail,
      scannerReportStatement: found.scannerReportStatement,
      statementCount: found.statementCount,
      securityStatements: found.securityStatements,
      qualificationEvaluated: found.qualificationEvaluated,
      securityQualification: found.securityQualification,
      qualificationFooter: found.qualificationFooter,
    },
  };
}
