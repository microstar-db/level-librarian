'use strict';

var access = require('safe-access')
var pull = require('pull-stream')
var pl = require('pull-level')
var _ = require('lodash')
var r = require('ramda')

module.exports = {
  read: read,
  write: write,
  resolveIndexDocs: resolveIndexDocs,
  addIndexDocs: addIndexDocs,
  makeIndexDocs: makeIndexDocs,
  makeIndexDoc: makeIndexDoc,
  makeRange: makeRange
}


function esc (string) {
  return string.replace('ÿ', '&&xff')
}


function read (db, query, pl_opts) {
  return pull(
    pl.read(db, makeRange(query, pl_opts)),
    resolveIndexDocs(db)
  )
}


function write (db, indexes, pl_opts, done) {
  return pull(
    addIndexDocs(indexes),
    pl.write(db, pl_opts, done)
  )
}


function resolveIndexDocs (db) {
  return pull.asyncMap(function (data, callback) {
    db.get(data.value, function (err, value) {
      callback(null, { key: data.value, value: value })
    })
  })
}


function addIndexDocs (indexes) {
  return pull(
    pull.map(function (item) {
      return makeIndexDocs({ key: item.key, value: item.value }, indexes)
    }),
    pull.flatten()
  )
}


function makeIndexDocs (doc, indexes) {
  var batch = [];

  // Generate an index doc for each index
  Object.keys(indexes).forEach(function (key) {
    batch.push(makeIndexDoc(doc, indexes[key]))
  })

  doc.type = 'put'
  batch.push(doc)

  return batch
}


function makeIndexDoc (doc, index) {
  if (!Array.isArray(index)) { index = [ index ] }
  var maybeKey = doc.key;
  var val = []

  index.forEach(function (keypath) {
    if (keypath === '$latest') {
      maybeKey = ''
    } else {
      val.push(esc(access(doc.value, keypath) + ''))
    }
  })

  return {
    key: 'ÿ' + index.join(',') + 'ÿ' + val.join('ÿ') + 'ÿ' + maybeKey + 'ÿ',
    value: doc.key,
    type: 'put'
  }
}


function makeRange (query, pl_opts) {
  if (!Array.isArray(query.k)) { query.k = [ query.k ] }
  if (!Array.isArray(query.v)) { query.v = [ query.v ] }

  function reduceV (acc, item) {
    if (!Array.isArray(item)) { item = [ item ] }
    acc.gte.push(esc(item[0]))
    acc.lte.push(esc(item[1] || item[0]))

    return acc
  }

  var acc = r.reduce(reduceV, { gte: [], lte: [] }, query.v)

  var compact = r.filter(r.identity)
  var lte = compact(acc.lte)
  var gte = compact(acc.gte)

  var range = {
    gte: 'ÿ' + esc(query.k.join(',')) + 'ÿ' + gte.join('ÿ') + 'ÿ',
    lte: 'ÿ' + esc(query.k.join(',')) + 'ÿ' + lte.join('ÿ') + 'ÿÿ'
  }

  return _.extend(pl_opts || {}, range)
}

