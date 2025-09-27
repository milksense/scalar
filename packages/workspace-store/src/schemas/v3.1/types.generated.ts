/** Contact information for the exposed API. */
export type ContactObject = {
  /** The identifying name of the contact person/organization. */
  name?: string
  /** The URI for the contact information. This MUST be in the form of a URI. */
  url?: string
  /** The email address of the contact person/organization. This MUST be in the form of an email address. */
  email?: string
}
/** The license information for the exposed API. */
export type LicenseObject = {
  /** REQUIRED. The license name used for the API. */
  name?: string
  /** An SPDX license expression for the API. The identifier field is mutually exclusive of the url field. */
  identifier?: string
  /** A URI for the license used for the API. This MUST be in the form of a URI. The url field is mutually exclusive of the identifier field. */
  url?: string
}
