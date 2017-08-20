const XLSX = require('xlsx')
const { Set } = require('immutable')
const _ = require('lodash')
const RestClient = require('./rest')

const ExcelCiviCrmKeyMap = require('./excel_civicrm_keymap')

const DEFAULT_LANGUAGE = 'en_GB'

const ID = 'ID'
const GENDER = 'Herr/Frau'
const TITLE = 'Titel'
const FIRST = 'Vorname'
const LAST = 'Nachname'
const ORGA = 'Institution'
const FUNCTION = 'Funktion'
const OPT_OUT = 'Kontakt erwünscht?'
const EMAIL_WORK = 'Email beruflich'
const EMAIL_HOME = 'Email privat'
const DONATE_PLATTFORM = 'Spendenplattform'
const PHONE_WORK = 'Telefon berufl.'
const MOBILE_HOME = 'Mobilnummer'
const PHONE_HOME = 'Telefon privat'
const POSTCODE = 'Adresse - PLZ'
const CITY = 'Adresse - Ort'
const STREET = 'Adresse - Straße'
const COUNTRY = 'Adresse - Land'
const BIRTH = 'Geburtsdatum'
const GROUP = 'Gruppe'
const TAG = 'Tag'
const MEMBER = 'Mitglied'
const SOURCE = 'Kontakt generiert durch'
const IBAN = 'IBAN'
const BIC = 'BIC'
const ACCOUNT_DATA_OK = 'Kontodaten gecheckt?'

const PREFIXES = []

const LANGUAGE_CODES = {
  'Deutschland': 'de_DE',
  'Österreich': 'de_DE',
  'UK': 'en_GB',
  'Belgien': 'nl_NL',
  'Frankreich': 'fr_FR',
  'Italien': 'it_IT',
  'Schweiz': 'de_DE',
  'Kanada': 'en_CA',
  'Irland': 'en_GB',
  'Niederlanden': 'nl_NL',
}

// console.log(process.argv[2])
const workbook = XLSX.readFile(process.argv[2])

async function createInstitutionContact(contact, noExternalId = false) {
  console.log('creating Organization contactId:', contact[ID])

  const req = new RestClient()

  const resCheck = await req.getEntity('contact', { contact_type: 'Organization', organization_name: contact[ORGA]})

  if (resCheck && resCheck.body && resCheck.body.count && resCheck.body.count !== 0) {
    return Object.keys(resCheck.body.values)[0]
  }

  let query = {
    contact_type: 'Organization',
    do_not_sms: 1,
    do_not_trade: 1,
    organization_name: contact[ORGA],
  }
  query = (!noExternalId) ? { ...query, ...{ external_identifier: contact[ID] } } : query;

  const res = await req.createEntity('contact', query)
  return res.body.id
}

function preferredLanguage(contact) {
  if (contact[GROUP]) {
    if (contact[GROUP].includes('Englisch') ||
        contact[GROUP].includes('Verteiler Seenotrettung')) {
      return 'en_GB'
    }
    if (contact[GROUP].includes('Deutsch') ||
        contact[GROUP].includes('Pressevertreter*innen_BPK') ||
        contact[GROUP].includes('Presseverteiler Institutionen')) {
      return 'de_DE'
    }
  }

  if (contact[COUNTRY]) {
    if (contact[COUNTRY].includes('Deutschland') ||
      contact[COUNTRY].includes('Österreich')) {
      return 'de_DE'
    }
  }

  if (!contact[COUNTRY]) {
    return 'de_DE'
  }

  return DEFAULT_LANGUAGE
}

function calculateGenderId(contact) {
  if (contact[GENDER]) {
    const g = contact[GENDER].trim()
    return (g === 'Frau') ? 1 : 2
  }
}

async function getPrefixes() {
  const req = new RestClient()
  const q = {
    option_group_id: 6,
    'options[limit]': 200,
  }
  const res = await req.getEntity('option_value', q)
  if (res.body.count && res.body.count > 0 && res.body.values) {
    for (const v in res.body.values) {
      PREFIXES[res.body.values[v].name] = res.body.values[v].value
    }
  }
  return
}

async function createPrefix(name) {
  console.log('creating prefix for title:', name)

  const q = {
    option_group_id: 6,
    name: name
  }

  const req = new RestClient()
  const res = await req.createEntity('option_value', q)

  if (res.body && res.body.values && res.body.count && res.body.count > 0) {
    const createdPrefix = res.body.values[Object.keys(res.body.values)[0]]
    PREFIXES[createdPrefix.name] = createdPrefix.value
    console.log('created prefix for title:', createdPrefix.name, ' id:', createdPrefix.value)
  }
  return
}

async function calculatePrefixId(contact) {
  if (contact[GENDER] && contact[TITLE]) {
    const prefix = `${contact[GENDER].trim()} ${contact[TITLE].trim()}`
    if (!PREFIXES[prefix]) {
      await createPrefix(prefix)
    }
    return PREFIXES[prefix]
  }
  if (contact[GENDER]) {
    const prefix = `${contact[GENDER].trim()}`
    if (PREFIXES[prefix]) {
      return PREFIXES[prefix]
    }
    await createPrefix(prefix)
    return PREFIXES[prefix]
  }
  return
}

async function createHouseholdContact(contact) {
  console.log('creating Household contactId:', contact[ID])

  let query = {
      contact_type: 'Household',
      do_not_sms: 1,
      do_not_trade: 1,
      external_identifier: contact[ID],
      preferred_language: preferredLanguage(contact),
      household_name: contact['household_name'],
  }
  const req = new RestClient()

  const contactResponse = await req.createEntity('contact', query)

  return contactResponse.body.id
}

async function createIndividualContact(contact, employerId = null, householdId = null, memberId = null) {
  console.log('creating Individual contactId:', contact[ID])
  let prefixId = await calculatePrefixId(contact)
  console.log('prefix_id', prefixId)

  const extId = (memberId) ? `${contact[ID]}_${memberId}` : contact[ID]

  let query = {
    contact_type: 'Individual',
    do_not_sms: 1,
    do_not_trade: 1,
    external_identifier: extId,
    gender_id: calculateGenderId(contact),
    prefix_id: prefixId,
    first_name: contact[FIRST],
    last_name: contact[LAST],
    birth_date: contact[BIRTH],
    preferred_language: preferredLanguage(contact),
    job_title: contact[FUNCTION],
  }

  query = (employerId) ? { ...query, ...{ employer_id: employerId }} : query;

  if (contact[OPT_OUT] && contact[OPT_OUT].toLowerCase() === 'nein') {
    query['do_not_mail'] = 1
    query['do_not_email'] = 1
    query['do_not_phone'] = 1
  }

  const req = new RestClient()
  const contactResponse = await req.createEntity('contact', query)

  if (householdId) {
    const relationsQuery = {
      contact_id_a: contactResponse.body.id,
      contact_id_b: householdId,
      relationship_type_id: 8,
    }
    const householdRelationResponse = await req.createEntity('relationship', relationsQuery)
  }


  return contactResponse.body.id
}

async function createEmails(id, contact, workFirst = false) {
  console.log('creating emails contactId:', contact[ID], id)
  const req = new RestClient()
  if (contact[EMAIL_WORK]) {
    let workEmailQuery = {
      contact_id: id,
      email: contact[EMAIL_WORK],
      location_type_id: 2
    }
    workEmailQuery = (workFirst) ? { ...workEmailQuery, ...{ is_primary: 1 } } : workEmailQuery;
    await req.createEntity('email', workEmailQuery)
  }

  if (contact[EMAIL_HOME]) {
    let privateEmailQuery = {
      contact_id: id,
      email: contact[EMAIL_HOME],
      location_type_id: 1
    }
    privateEmailQuery = (!workFirst) ? { ...privateEmailQuery, ...{ is_primary: 1 } } : privateEmailQuery;
    await req.createEntity('email', privateEmailQuery)
  }
}

async function createPhones(id, contact, workFirst) {
  console.log('creating phones external ContactId - internal ContactId:', contact[ID], ' - ', id)
  const req = new RestClient()
  if (contact[PHONE_WORK]) {
    let workPhoneQuery = {
      contact_id: id,
      phone: contact[PHONE_WORK],
      location_type_id: 2,
      phone_type_id: 1
    }
    workPhoneQuery = (workFirst) ? { ...workPhoneQuery, ...{ is_primary: 1 } } : workPhoneQuery;
    await req.createEntity('phone', workPhoneQuery)
  }

  if (contact[MOBILE_HOME]) {
    const mobilePhoneQuery = {
      contact_id: id,
      phone: contact[MOBILE_HOME],
      location_type_id: 1,
      phone_type_id: 2
    }
    await req.createEntity('phone', mobilePhoneQuery)
  }

  if (contact[PHONE_HOME]) {
    let homePhoneQuery = {
      contact_id: id,
      phone: contact[PHONE_HOME],
      location_type_id: 1,
      phone_type_id: 1
    }
    homePhoneQuery = (!workFirst) ? { ...homePhoneQuery, ...{ is_primary: 1 } } : homePhoneQuery;
    await req.createEntity('phone', homePhoneQuery)
  }
}

async function createAddress(id, contact, workPlace = false) {
  console.log('creating address external ContactId - internal ContactId:', contact[ID], ' - ', id)
  const req = new RestClient()
  const countryCodes = {
    'Australien': '1013',
    'Belgien': '1020',
    'Deutschland': '1082',
    'Großbritannien': '1226',
    'Kanada': '1039',
    'UK': '1226',
    'Schweiz': '1205',
    'Niederlande': '1152',
    'Italien': '1107',
    'Vereinigte Staaten': '1228',
    'USA': '1228',
    'Norwegen': '1161',
    'Israel': '1106',
    'Schottland': '1226',
    'Vereinigte Staaten von Amerika': '1228',
    'Spanien': '1198',
    'Österreich': '1014',
    'Niederlanden': '1152',
    'Südafrika': '1196',
    'Schweden': '1204',
    'Malta': '1134',
    'Rumänien': '1176',
    'Irland': '1105',
  }

  const countryCode = countryCodes[contact[COUNTRY]] || '1082'

  const addressQuery = {
    contact_id: id,
    postal_code: contact[POSTCODE],
    city: contact[CITY],
    street_address: contact[STREET],
    country_id: countryCode,
    location_type_id: (workPlace) ? 2 : 1,
  }

  await req.createEntity('address', addressQuery)
}

async function createBankAccount(id, contact) {
  console.log('creating bank data external ContactId - internal ContactId:', contact[ID], ' - ', id)
  const req = new RestClient()
  if (contact[IBAN]) {
    let ibanQuery = {
      entity_id: id,
      custom_1: contact[IBAN]
    }

    ibanQuery = (contact[BIC]) ? { ...ibanQuery, ...{ custom_2: contact[BIC] }} : ibanQuery

    await req.createEntity('customValue', ibanQuery)
  }
}

function parseGroups(groups) {
  let _o = []
  let _g = groups.split(',').map(g => g.trim())

  if (_g.length > 0) {
    (_g.includes('Pressevertreter*innen_BPK')) ? _o.push(3):null;
    (_g.includes('Presseverteiler Englisch')) ? _o.push(4):null;
    (_g.includes('Presseverteiler Deutsch')) ? _o.push(5):null;
    (_g.includes('Presseverteiler Institutionen')) ? _o.push(6):null;
    (_g.includes('Verteiler Seenotrettung')) ? _o.push(7):null;
  }

  return _o
}

function parseMemberStates(memberStates) {
  let _o = []
  let _m = memberStates.split(',').map(g => g.trim())

  if (_m.length > 0) {
    (_m.includes('Ordentliches Mitglied')) ? _o.push(8):null;
  }
  return _o
}

function parseDonatePlatformStates(donationPlatform) {
  let platforms = donationPlatform.split(',').map(g => g.trim())
  return platforms
}

function parseNameField(name) {
  return name.split('+').map(n => n.trim())
}

async function parseHouseholdContact(row) {
  var him
  var her
  var household
  var hisResponseId
  var herResponseId
  var householdResponseId

  if (row[LAST]) {
    let lastNames = parseNameField(row[LAST])
    let firstNames = parseNameField(row[FIRST])


    if (lastNames.length === 2 && firstNames.length === 2) {
      household = _.clone(row)
      her = _.clone(row)
      him = _.clone(row)

      household[LAST] = ''
      household[FIRST] = ''
      household['household_name'] = lastNames.join(' + ')

      her[LAST] = lastNames[1]
      her[GENDER] = 'Frau'
      const herTitleName = firstNames[1].split(' ')

      if (herTitleName.length > 1) {
        her[TITLE] = herTitleName.slice(0, herTitleName.length - 1).join(' ')
        her[FIRST] = herTitleName[herTitleName.length - 1]
      } else {
        her[FIRST] = firstNames[1]
      }

      him[LAST] = lastNames[0]
      him[GENDER] = 'Herr'
      const hisTitleName = firstNames[0].split(' ')

      if (hisTitleName.length > 1) {
        him[TITLE] = hisTitleName.slice(0, hisTitleName.length - 1).join(' ')
        him[FIRST] = hisTitleName[hisTitleName.length - 1]
      } else {
        him[FIRST] = firstNames[0]
      }
      if (row[TITLE]) {
        him[TITLE] = row[TITLE]
      }
    }
    if (lastNames.length === 1 && firstNames.length === 2) {
      household = _.clone(row)
      her = _.clone(row)
      him = _.clone(row)

      household[LAST] = ''
      household[FIRST] = ''
      household['household_name'] = lastNames[0]


      her[LAST] = lastNames[0]
      her[GENDER] = 'Frau'
      her[TITLE] = ''
      const herTitleName = firstNames[1].split(' ')

      if (herTitleName.length > 1) {
        her[TITLE] = herTitleName.slice(0, herTitleName.length - 1).join(' ')
        her[FIRST] = herTitleName[herTitleName.length - 1]
      } else {
        her[FIRST] = firstNames[1]
      }

      him[LAST] = lastNames[0]
      him[GENDER] = 'Herr'
      const hisTitleName = firstNames[0].split(' ')

      if (hisTitleName.length > 1) {
        him[TITLE] = hisTitleName.slice(0, hisTitleName.length - 1).join(' ')
        him[FIRST] = hisTitleName[hisTitleName.length - 1]
      } else {
        him[FIRST] = firstNames[0]
      }
      if (row[TITLE]) {
        him[TITLE] = row[TITLE]
      }
    }
    if (lastNames.length === 2 && firstNames.length === 0) {
      household = _.clone(row)

      household[LAST] = ''
      household[FIRST] = ''
      household['household_name'] = lastNames.join(' + ')
    }
    if (lastNames.length === 1 && firstNames[0].trim() === '') {
      household = _.clone(row)

      household[LAST] = ''
      household[FIRST] = ''
      household['household_name'] = lastNames[0]
    }
    if (lastNames.length === 1 && firstNames.length === 0) {
      household[LAST] = ''
      household[FIRST] = ''
      household['household_name'] = lastNames[0]
    }
  }
  console.log(household)
  if (household) {
    householdResponseId = await createHouseholdContact(household)
  }

  if (her) {
    herResponseId = await createIndividualContact(her, null, householdResponseId, 1)
  }

  if (him) {
    hisResponseId = await createIndividualContact(him, null, householdResponseId, 2)
  }

  console.log(`created Household with ID ${householdResponseId} and her ID ${herResponseId} and his ID ${hisResponseId}`)

  return householdResponseId

}

async function createGroupMembership(contactId, groupId) {
  const req = new RestClient()
  const q = {
    contact_id: contactId,
    group_id: groupId,
    status: 'Added'
  }
  await req.createEntity('group_contact', q)
}

async function createTag(contactId, tagId) {
  const req = new RestClient()
  const q = {
    entity_table: 'civicrm_contact',
    entity_id: contactId,
    tag_id: tagId
  }
  await req.createEntity('entity_tag', q)
}


async function createGroupsAndTags(contactId, contact) {
  console.log('creating group membership external ContactId - internal ContactId:', contact[ID], ' - ', contactId)
  if (contact[GROUP]) {
    const groupsToCreate = parseGroups(contact[GROUP])

    for (let g of groupsToCreate) {
      await createGroupMembership(contactId, g)
    }
  }
  if (contact[MEMBER]) {
    const groupsFromMemberState = parseMemberStates(contact[MEMBER])
    for (let m of groupsFromMemberState) {
      await createGroupMembership(contactId, m)
    }
  }
  if (contact[DONATE_PLATTFORM]) {
    const donationPlatforms = parseDonatePlatformStates(contact[DONATE_PLATTFORM])
    for (let d of donationPlatforms) {
      if (d === 'Betterplace') {
        await createTag(contactId, 7)
      }
      if (d === 'Altruja') {
        await createTag(contactId, 6)
      }
    }
  }
}

async function createContactGeneratedBy(contactId, contact) {
  console.log('creating contact reference external ContactId - internal ContactId:', contact[ID], ' - ', contactId)
  const req = new RestClient()
  const addedByQuery = {
    entity_id: contactId,
    custom_3: contact[SOURCE],
  }
  await req.createEntity('customValue', addedByQuery)
}

async function checkForContactExistence(id) {
  const req = new RestClient()
  const q = {
    external_identifier: id,
  }
  const res = await req.getEntity('contact', q)

  if (res && res.body && res.body.count && res.body.count > 0) {
    return true
  }

  return false
}

async function jobRowMainRoutine(row) {
  let queries = []
  let contactId
  let employerId
  let householdId

  const userExists = await checkForContactExistence(row[ID])

  if (!userExists) {
    if (row[ORGA] && !row[FIRST] && !row[LAST]) {
      contactId = await createInstitutionContact(row)
    }
    if (row[ORGA] && row[FIRST] && row[LAST] &&
        (!row[FIRST].includes('+') && !row[LAST].includes('+'))) {
      employerId = await createInstitutionContact(row, true)

      contactId = await createIndividualContact(row, employerId)
    }

    if (!row[ORGA] && row[FIRST] && row[LAST] &&
       (row[FIRST].split('+').length > 1 || row[LAST].split('+').length > 1)) {
       householdId = await parseHouseholdContact(row)
    }

    if (!row[ORGA] && row[FIRST] && row[LAST] &&
       (!row[FIRST].includes('+') && !row[LAST].includes('+'))) {
       contactId = await createIndividualContact(row)
    }

    const id = contactId || householdId

    if (row[EMAIL_WORK] || row[EMAIL_HOME]) {
      await createEmails(id, row, employerId)
    }

    if (row[PHONE_WORK] || row[MOBILE_HOME] || row[PHONE_HOME]) {
      await createPhones(id, row)
    }

    if (row[POSTCODE] || row[STREET] || row[CITY] || row[COUNTRY]) {
      await createAddress(id, row, employerId)
    }

  //  if ((row[IBAN] || row[BIC]) && row[ACCOUNT_DATA_OK])  {
    if (row[IBAN] || row[BIC]) {
      await createBankAccount(id, row)
    }

    if (row[SOURCE]) {
      await createContactGeneratedBy(id, row)
    }

    if (row[GROUP] || row[TAG] || row[MEMBER] || row[DONATE_PLATTFORM]) {
      await createGroupsAndTags(id, row)
    }

    console.log(`finished extern: ${row[ID]} - intern: ${id}`)
    console.log(row[ORGA] + ' - ' + row[FIRST] + ' ' + row[LAST])
  } else {
    console.log('User existiert bereits: ', row[ID])
  }
  return
}
var i = 0
function jobRowPressFilterRoutine(row) {
  // if (row[ID] === '787') {
  //   return true
  // }

  //filter specific ids that should be inserted manually
  if (['2246', '138', '2005', '2314', '3245'].includes(row[ID])) {
    return false
  }

  // if (Object.keys(row).includes(GROUP)) {
  //   let groups = row[GROUP].split(',').map(g => g.trim())

  //   return groups.includes('Pressevertreter*innen_BPK') ||
  //       groups.includes('Presseverteiler Englisch') ||
  //       groups.includes('Presseverteiler Deutsch') ||
  //       groups.includes('Presseverteiler Institutionen') ||
  //       groups.includes('Verteiler Seenotrettung')
  //  }

  // if (Object.keys(row).includes(DONATE_PLATTFORM)) {
  //   let donatePlattform = row[DONATE_PLATTFORM].split(',').map(g => g.trim())
  //   //console.log(donatePlattform)

  //   return donatePlattform.includes('Betterplace') ||
  //     donatePlattform.includes('Altruja')
  // }

  return true
}

const rawSheet = workbook.Sheets[workbook.SheetNames[0]]

const jsonSheet = XLSX.utils.sheet_to_json(rawSheet)

//const testEntries = filteredEntries.filter(r => ['1010', '3979', '673'].includes(r[ID]))

async function main() {
  await getPrefixes()

  console.log('found existing Prefixes')
  console.log(PREFIXES)

  console.log('Gesamt:', jsonSheet.length)
  const filteredEntries = jsonSheet.filter(jobRowPressFilterRoutine)
  console.log('Gefundene Einträge : ' + filteredEntries.length)
  for (let row of filteredEntries) {
    await jobRowMainRoutine(row)
  }
}

main()
