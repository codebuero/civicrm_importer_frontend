import Promise from 'bluebird'
import {
    isString,
    isFunction,
    isEmpty
} from 'lodash'
import {
    groupPayload,
    tagPayload,
    parseInstrument,
    parseFinancialType,
    getPayloadRules,
} from './payload-rules'
import {
    rest
} from './rest'

const PAYLOAD_ALLOW_LIST = [
    'address',
    'email',
    'email_work',
    'email_other',
    'contribution',
    'customValue',
    'group_contact',
    'entity_tag',
    'phone_work',
    'phone_mobile',
]

const ImportService = {
    mapDataOnRuleset: function(data = [], ruleSet = {}, groupId = 0, selectedTags = [], countries = []) {
        return data.map(row => this._mapRowToRules(row, ruleSet, groupId, selectedTags, countries));
    },
    _getCountryIdForFullCountryName: function(countryName) {
        const countryIds = {
            'Deutschland': '1082',
            'Belgien': '1020',
            'Dänemark': '1059',
            'Europäische Union': '1014',
            'Finnland': '1075',
            'Frankreich': '1076',
            'Irland': '1105',
            'Italien': '1107',
            'Kanada': '1039',
            'Luxemburg': '1126',
            'Österreich': '1014',
            'Mexiko': '1140',
            'Niederlande': '1152',
            'Polen': '1172',
            'Portugal': '1173',
            'Schweden': '1204',
            'Schweiz': '1205',
            'Senegal': '1188',
            'Singapur': '1191',
            'Spanien': '1198',
            'Vereinigte Arabische Emirate': '1225',
            'Vereinigte Staaten': '1228',
            'Vereinigtes Königreich': '1226',
        };
        return countryIds[countryName];
    },
    _getCountryIdForCountryISOCode: function(countryIsoCode, availableCountries) {
        const foundCountry = availableCountries.filter(c => c['iso_code'] === countryIsoCode)
        if (!foundCountry.length) return
        return foundCountry[0]['id']
    },
    _getCountryId: function(country, availableCountries) {
        if (!isString(country)) return

        if (country.length === 2) {
            return this._getCountryIdForCountryISOCode(country, availableCountries)
        }
        return this._getCountryIdForFullCountryName(country)
    },
    _enhanceWithGroupPayload: function(basePayload, groupId = 0) {
        if (!groupId) return basePayload

        return {
            ...basePayload,
            group_contact: groupPayload(groupId),
        }
    },
    _enhanceWithTagPayload: function(basePayload, selectedTags = []) {
        if (!selectedTags.length) return
        return {
            ...basePayload,
            entity_tag: tagPayload(selectedTags),
        }
    },
    _mapRowToRules: function(row, ruleSetTitle, groupId = 0, selectedTags, countries) {
        const countryId = this._getCountryId(row['Land'] ||  row['Country'], countries)

        let enhancedRow = {}

        enhancedRow = this._enhanceWithGroupPayload(enhancedRow, groupId)
        enhancedRow = this._enhanceWithTagPayload(enhancedRow, selectedTags)

        const ruleSet = getPayloadRules(ruleSetTitle)
        const keysToMatch = Object.keys(ruleSet)
        enhancedRow = keysToMatch.reduce((acc, key) => ({...acc,
            [key]: ruleSet[key]({...row,
                countryId
            })
        }), {...enhancedRow
        })

        return enhancedRow;
    },
    _filterContent: function(k, data) {
        if (k === 'customValue') {
            if (!data['custom_1']) return false
            if (!data['custom_1'] && !data['custom_2']) return false
        }
        if (k === 'contribution') {
            if (data['total_amount'] < 0) return false
        }
        return true;
    },
    rejectWithEmail(emails = [], errors = []) {
        const err = new Error(`Couldnt create new account for email ${emails.join(',')}`)
        err.data = errors
        return Promise.reject(err);
    },
    _extractEmails(account) {
        const out = []

        Array.from(['email', 'email_work', 'email_other']).forEach((key) => {
            if (isFunction(account[key])) {
                out.push(account[key]().email)
            }
        })

        return out
    },
    _checkForAccountExistence: async function(emails = []) {
        let existingUserId = 0
        for (let email of emails) {
            try {
                existingUserId = await rest.checkIfEmailExists(email)
                break;
            } catch (e) {
                continue
            }
        }
        return existingUserId
    },
    doImport: async function(account) {
        let knownEmails = this._extractEmails(account)
        let existingUserId = await this._checkForAccountExistence(knownEmails)

        // existence promise: if rejected, account does not exist. if resolved, it contains an id. 

        /*   const existingContactId = await account.exists()
         *   
         *   if (!existingContactId) return await account.create() - incl. all contact related entities and contributions
         *   
         *   account.setContactId(existingContactId)
         *   await account.createContribution()
         */

        if (!existingUserId) {
            let organizationId
            if (account['organization']) {
                const organizationPayload = account['organization']
                const {
                    is_error,
                    id: orgaId
                } = await rest.createEntity('contact', organizationPayload)
                if (is_error || !orgaId) {
                    return this.rejectWithEmail(knownEmails);
                }
                organizationId = orgaId
            }

            const contactPayload = account['contact'](organizationId)
            const {
                is_error,
                id
            } = await rest.createEntity('contact', contactPayload)

            if (is_error || !id) {
                return this.rejectWithEmail(knownEmails);
            }

            const errors = []

            for (const k of PAYLOAD_ALLOW_LIST) {
                // the tag payloads are in an array of functions, not only a function
                if (!account[k]) continue
                if (Array.isArray(account[k])) {
                    const payloadsWithContactId = account[k].map(p => p(id))

                    for (let p of payloadsWithContactId) {
                        const pRes = await rest.createEntity(k, p)
                        if (pRes.is_error) return errors.push(pRes)
                    }
                }
                // all other payloads are a curried function where the payload is derived
                // after calling the function with the id of the created contact
                if (typeof account[k] === "function") {
                    if (isEmpty(account[k](id))) continue
                    const payloadWithContactId = account[k](id)
                    if (this._filterContent(k, payloadWithContactId)) {
                        const pRes = await rest.createEntity(k, payloadWithContactId)
                        if (pRes.is_error) return errors.push(pRes)
                    }
                }
            }
        } else {
            if (!account['contribution']) return;
            const payload = account['contribution'](existingUserId)
            const contributionExists = await rest.checkForExistingContribution(existingUserId, payload['total_amount'], payload['receive_date'])
            if (contributionExists) return
            const pRes = await rest.createEntity('contribution', payload)
            if (pRes.is_error) return errors.push(pRes)
        }

        if (errors.length) {
            return this.rejectWithEmail(knownEmails, errors)
        }

        return;
    }
};

export default ImportService;