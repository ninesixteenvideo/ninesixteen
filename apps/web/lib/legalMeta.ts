export const SERVICE_NAME = "ninesixteen.video";
export const SITE_URL = "https://ninesixteen.video";
export const LEGAL_CONTACT_EMAIL = "dev@ninesixteen.video";
/** Where the Service is operated from (shown in legal documents). */
export const OPERATOR_LOCATION = "Western Australia, Australia";
/** Entity name used in legal documents (update if you register a company name). */
export const OPERATOR_NAME = "ninesixteen.video";
/** ISO date shown at the top of legal pages. Update when policies change materially. */
export const LEGAL_EFFECTIVE_DATE = "June 13, 2026";

export type LegalSection = {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
};
