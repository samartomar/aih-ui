/*
 * The Sources & Catalogs elements, looked up once and handed to the components
 * that own them. No component looks an element up for itself, and none reaches
 * into another's subtree.
 */

import { collectIds } from "../app/dom.js";

export function catalogElements() {
  const ids = [
    "provenance-strip", "masthead-version", "masthead-facts",
    "nav-sources-count", "rail-package-version", "rail-package-count",
    "rail-kind-list", "rail-source-list", "framework-matrix-tabs",
    "kind-filters", "catalog-search", "source-filter", "sort-select",
    "visible-count", "visible-caption", "cards-grid",
    "inspector-name", "inspector-kind", "inspector-version", "inspector-subtitle",
    "inspector-flags", "inspector-icon",
    "details-identity", "details-source", "details-desc", "details-capabilities",
    "details-artifacts", "scanner-report-statement", "statement-count", "security-statements",
  ];
  const found = collectIds(ids);
  return {
    provenance: {
      provenanceStrip: found.provenanceStrip,
      mastheadFacts: found.mastheadFacts,
      mastheadVersion: found.mastheadVersion,
    },
    navigation: {
      navSourcesCount: found.navSourcesCount,
      railPackageVersion: found.railPackageVersion,
      railPackageCount: found.railPackageCount,
      scopeList: found.railKindList,
      sourceList: found.railSourceList,
    },
    metrics: { container: found.frameworkMatrixTabs },
    toolbar: {
      kindFilters: found.kindFilters,
      search: found.catalogSearch,
      sourceFilter: found.sourceFilter,
      sortSelect: found.sortSelect,
    },
    cards: {
      cardsGrid: found.cardsGrid,
      visibleCount: found.visibleCount,
      visibleCaption: found.visibleCaption,
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
      scannerReportStatement: found.scannerReportStatement,
      statementCount: found.statementCount,
      securityStatements: found.securityStatements,
    },
  };
}
