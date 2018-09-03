
function parseInstrument(row){
  const source = row['Quelle']
  const sourceIdMap = {
    'Online (Wirecard/Kreditkarte)': 10,
    'Online (Wirecard/Lastschrift)': 9,
    'direkt / PayPal': 8,
    'Soforüberweisung': 7,
    'Offline-Spende': 3,
  }
  return sourceIdMap[source]
}

function parseFinancialType(row){
  const type = row['Spenden-Typ']

  const typeIdMap = {
    'Einzelspende': 1,
    'Dauererstspende': 5,
    'Dauerfolgespende': 5,
  }

  return typeIdMap[type]
}

function calculateTagsFromDonation(row, availableTags) {
  const type = row['Spenden-Typ'];

  if (!type) return [];

  const typeTagMap = {
    'Einzelspende': '',
    'Dauererstspende': 5,
    'Dauerfolgespende': 5,
  }

  return [tag]
}

const altrujaPayload = {
  contact: (row) => {
    const noContact = row['Kontakt erlaubt'] === 'nein';
    const prefixId = row['Anrede'] === 'Frau' ? 2 : 1;
    const genderId = row['Anrede'] === 'Frau' ? 1 : 2;

    const notificationRules = {
      do_not_mail: !noContact ? 0 : 1,
      do_not_email: !noContact ? 0 : 1,
      do_not_phone: !noContact ? 0 : 1,
      is_opt_out: !noContact ? 0 : 1,
      do_not_sms: !noContact ? 0 : 1,
      do_not_trade: !noContact ? 0 : 1,
    }

    return {
      contact_type: 'Individual',
      preferred_language: 'de_DE',
      first_name: row['Vorname'],
      last_name: row['Nachname'],
      prefix_id: prefixId,
      gender_id: genderId,
      ...notificationRules,
    }
  },
  email: (row) => (contactId = 0) => ({
    contact_id: contactId,
    email: row['Email'],
    location_type_id: 1,
    is_primary: 1,
  }),
  address: (row) => (contactId = 0) => ({
    contact_id: contacId,
    street_address: row['Adresse'],
    location_type_id: 1,
    is_primary: 1,
    city: row['Ort'],
    postal_code: row['Postleitzahl'],
    country_id: row['CountryId'],
  }),
  iban: (row) => (contactId = 0) => ({
    entity_id: contactId,
    custom_1: row['IBAN'],
    custom_2: row['BIC']
  }),
  donation: (row) => (contactId = 0) => ({ 
    contact_id: contactId,
    financial_type_id: parseFinancialType(row),
    payment_instrument_id: parseInstrument(row),
    receive_date: moment(row['Datum'], 'DD.MM.YYYY').format(),
    total_amount: row['Spendenbetrag'],
    trxn_id: row['Spenden-ID'],
    currency: 'EUR',
    source: 'Altruja',
    contribution_status_id: 1,
  }),
}


const onlycontactsPayload = {
  contact: () => {

  },
  address: () => {

  },
  email: () => {

  },
  phone: () => {

  },
  donation: () => {

  }
}

const groupPayload = (groupId) => (contactId) => ({
  contact_id: contactId,
  group_id: groupId,
  status: 'Added'
})

const tagPayload = (tagIds = []) => {
  return tagIds.map((tagId) => (contactId) => ({
    entity_table: 'civicrm_contact',
    entity_id: contactId,
    tag_id: tagId
  }))
}

export {
  altrujaPayload,
  onlycontactsPayload,
  groupPayload,
  tagPayload,
  parseInstrument,
  parseFinancialType,
}