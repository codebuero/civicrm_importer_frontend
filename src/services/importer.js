import Promise from 'bluebird'
import { 
  groupPayload, 
  tagPayload, 
  parseInstrument, 
  parseFinancialType, 
  getPayloadRules,
} from './payload-rules'
import { rest } from './rest'

const PAYLOAD_ALLOW_LIST = ['address','email','contribution','customValue', 'group_contact', 'entity_tag']

const ImportService = {
  mapDataOnRuleset: function(data = [], ruleSet = {}, groupId = 0, selectedTags = []) {
    return data.map(row => this._mapRowToRules(row, ruleSet, groupId, selectedTags));
  },
  _getCountryId: function(row) {
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

      return countryIds[row['country']];
  },
  _mapRowToRules: function(row, ruleSetTitle, groupId, selectedTags) {
    let out = {
      emailAddress: row['email'],
      countryId: this._getCountryId(row),
    };

    if (groupId) {
      out = { 
        ...out,
        group_contact: groupPayload(groupId),
      }
    }

    if (selectedTags.length) {
      out = { 
        ...out,
        entity_tag: tagPayload(selectedTags),
      }        
    }

    const ruleSet = getPayloadRules(ruleSetTitle)
    const keysToMatch = Object.keys(ruleSet);
    keysToMatch.forEach((key) => {
      out[key] = ruleSet[key](row);
    });

    return out;
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
  rejectWithEmail(email) {
    return Promise.reject(new Error(`Couldnt create new account for email ${email}`));
  },
  doImport: async function(account) {
      const existingUserId = await rest.checkIfEmailExists(account.emailAddress)

      if (!existingUserId) {

        let organizationId
        if (account['organization']) {
          const organizationPayload = account['organization']
          const { is_error, id: orgaId } = await rest.createEntity('contact', organizationPayload)
          if (is_error || !orgaId) {
            return this.rejectWithEmail(account.emailAddress);
          }
          organizationId = orgaId
        }

        const contactPayload = account['contact'](organizationId);
        const { is_error, id } = await rest.createEntity('contact', contactPayload)

        if (is_error || !id) {
          return this.rejectWithEmail(account.emailAddress);
        }

        for (const k of PAYLOAD_ALLOW_LIST) {
          // the tag payloads are in an array of functions, not only a function
          if (Array.isArray(account[k])) {
            const payloadsWithContactId = account[k].map(p => p(id))

            for(let p of payloadsWithContactId) {
              const pRes = await rest.createEntity(k, p)
              if (pRes.is_error) return this.rejectWithEmail(account.emailAddress);
            }
            continue;
          }
          // all other payloads are a curried function where the payload is derived
          // after calling the function with the id of the created contact
          if (typeof account[k] === "function") {
            const payloadWithContactId = account[k](id);
            if (this._filterContent(k, payloadWithContactId)) {
              const pRes = await rest.createEntity(k, payloadWithContactId)
              if (pRes.is_error) return this.rejectWithEmail(account.emailAddress);
            } 
          }
        }
      } else {
        const payload = account['contribution'](existingUserId)
        const contributionExists = await rest.checkForExistingContribution(existingUserId, payload['total_amount'], payload['receive_date'])
        if (!contributionExists) {
          const pRes = await rest.createEntity('contribution', payload)
          if (pRes.is_error) return this.rejectWithEmail(account.emailAddress);
        }
      }

      return;
    }
};

export default ImportService;