import React, {Component} from 'react'
import {isEqual, isNil, each, map, isEmpty, includes, concat } from 'lodash'
import {join} from 'path'
// import fs from 'fs-extra'
import { connect } from 'react-redux'
import { promisifyAll } from 'bluebird'
const fs = promisifyAll (require ('fs-extra'))
const CSON = promisifyAll(require('cson'))
import {store} from 'views/create-store'
import semver from 'semver'

import BattleViewArea from './views/battle-view-area'

import {initEnemy, spotInfo, getSpotKind, lostKind} from './utils'


import { Simulator } from './lib/battle'
import { Ship, ShipOwner, StageType, Battle, BattleType, Fleet } from './lib/battle/models'
import { fleetShipsDataSelectorFactory, fleetShipsEquipDataSelectorFactory } from 'views/utils/selectors'

const { i18n, ROOT, getStore } = window
//const { fleetShipsDataSelectorFactory } = require(`${ROOT}/views/utils/selectors`)

const __ = i18n["poi-plugin-prophet"].__.bind(i18n["poi-plugin-prophet"])


// information related to spot info, will move to utils or something later



const updateByStageHp = (fleet, nowhps) => {
  if (!fleet) return fleet
  for (const ship of fleet) {
    if (ship) {
      ship.from = nowhps.shift()
    }
  }
  return fleet
}

// extracts necessary information from its stages, returns a new simulator
// infomation:
const synthesizeStage = (_simulator, result, packets) => {
  let {mainFleet, escortFleet, enemyFleet, enemyEscort, stages, api_formation, airForce, airControl} = {..._simulator}
  // assign mvp to specific ship
  let [mainMvp, escortMvp] = result.mvp || [0, 0]
  if (!( mainMvp < 0 || mainMvp > 6 )) mainFleet[mainMvp].isMvp = true
  if (!( escortMvp < 0 || escortMvp > 6 )) escortFleet[escortMvp].isMvp = true

  each(stages, (stage) => {
    if (isNil(stage)) return
    let {api_stage1, api_stage2, api_stage3} = (stage || {}).kouku || {}
    if(stage.type == StageType.Engagement) {
      // api_search = pick(stage.api, ['api_search']).api_search
      api_formation = (stage.api || {}).api_formation
    }
    if (!isNil(api_stage1) && stage.type == StageType.Aerial ) {
      airForce = getAirForceStatus([api_stage1, api_stage2, api_stage3])
      airControl = api_stage1.api_disp_seiku
    }
  })

  let api_nowhps
  each(packets, packet => {
    if (packet && packet.api_nowhps) {
      api_nowhps = packet.api_nowhps
    }
  })

  api_nowhps.shift()
  mainFleet = updateByStageHp(mainFleet, api_nowhps)
  escortFleet = updateByStageHp(escortFleet, api_nowhps)
  enemyFleet = updateByStageHp(enemyFleet, api_nowhps)
  enemyEscort = updateByStageHp(enemyEscort, api_nowhps)

  return {
    mainFleet,
    escortFleet,
    enemyFleet,
    enemyEscort,
    airControl,
    airForce,
    api_formation,
    result,
  }
}

const getAirForceStatus = (stages=[]) => {
  let t_api_f_count = 0, t_api_f_lostcount = 0, t_api_e_count = 0, t_api_e_lostcount = 0
  for (const stage of stages) {
    if (stage) {
      let {api_f_count, api_f_lostcount, api_e_count, api_e_lostcount} = stage
      t_api_f_count += api_f_count || 0
      t_api_f_lostcount += api_f_lostcount || 0
      t_api_e_count += api_e_count || 0
      t_api_e_lostcount += api_e_lostcount || 0
    }
  }
  return [t_api_f_count, t_api_f_lostcount, t_api_e_count, t_api_e_lostcount]
}

// reducer for mapspot and maproute data
export const reducer = (state, action) => {
  if (state == null) {
    state = {}
  }
  if (action.type === '@@poi-plugin-prophet/updateMapspot') {
    return ({
      ...state,
      mapspot: action.data,
    })
  }
  if (action.type === '@@poi-plugin-prophet/updateMaproute') {
    return ({
      ...state,
      maproute: action.data,
    })
  }
  return state
}


// sortieState
// 0: port, switch on when /kcsapi/api_port/port
// 1: before battle, switch on when /kcsapi/api_req_map/start or /kcsapi/api_req_map/next
// 2: battle, switch on with PM emit type
// 3: practice, switch on with PM emit type



export const reactClass = connect(
  (state) => {
    const sortie = state.sortie || {}
    const sortieStatus = sortie.sortieStatus || []
    const airbase = state.info.airbase || {}
    const fleet = []
    if (sortieStatus.reduce((a, b) => a || b)) {
      sortieStatus.forEach((a, i) => {
        if (a) fleet.push(i)
      })
    } else if (sortie.combinedFlag) {
      fleet.push(0, 1)
    } else {
      fleet.push(0)
    }
    const fleets = fleet.map(i => fleetShipsDataSelectorFactory(i)(state))
    const equips = fleet.map(i => fleetShipsEquipDataSelectorFactory(i)(state))
    return {
      sortie,
      airbase,
      fleets,
      equips,
    }
  }
)(class Prophet extends Component {
  constructor(props){
    super(props)
    const [mainFleet, escortFleet] = this.transformToLibBattleClass(props.fleets, props.equips)
    this.state ={
      ...this.constructor.initState,
      mainFleet,
      escortFleet,
    }
  }
  static initState = {
    mainFleet: [], // An array of fleet
    escortFleet: [],
    enemyFleet: [],
    enemyEscort: [],
    landBase: [],
    airForce: [], // [count, lostCount, enemyCount, enemyLostCount]
    airControl: 0, // 0=制空均衡, 1=制空権確保, 2=航空優勢, 3=航空劣勢, 4=制空権喪失
    isAirRaid: false,
    sortieState: 0, // 0: port, 1: before battle, 2: battle, 3: practice
    spotKind: '',
    result: {},
    api_formation: [], // [null, Formation, Engagement]
  }

  componentWillMount() {
    fs.readFileAsync(join(__dirname, 'assets', 'data', 'mapspot.cson'))
    .then ((data) =>{
      const mapspot = CSON.parseCSONString(data)
      store.dispatch({
        type: '@@poi-plugin-prophet/updateMapspot',
        data: mapspot,
      })
    })
    .catch ((e) => console.warn('Failed to load map data!', e.stack))

    fs.readFileAsync(join(__dirname, 'assets', 'data', 'maproute.cson'))
    .then ((data) =>{
      const mapspot = CSON.parseCSONString(data)
      store.dispatch({
        type: '@@poi-plugin-prophet/updateMaproute',
        data: mapspot,
      })
    })
    .catch ((e) => console.warn('Failed to load map route!', e.stack))
  }

  componentWillReceiveProps(nextProps) {
    if (!isEqual(this.props.fleets, nextProps.fleets) ||!isEqual (this.props.equips, nextProps.equips)) {
      const [mainFleet, escortFleet] = this.transformToLibBattleClass(nextProps.fleets, nextProps.equips)
      this.setState({
        mainFleet,
        escortFleet,
      })
    }
  }

  componentDidMount() {
    // initialize repsonse listener
    window.addEventListener('game.response', this.handleGameResponse)

    // for debug (ugly)
    if (window.dbg.isEnabled()) window.prophetTest = (e) => this.setState(this.handlePacket(JSON.parse(e)))
  }

  componentWillUnmount() {
    window.removeEventListener('game.response', this.handleGameResponse)

    delete window.prophetTest
  }

  transformToLibBattleClass = (fleets, equips) =>
    (fleets || []).map((fleet, fleetPos) =>
      (fleet|| []).map(([_ship, $ship], shipPos) =>
        new Ship({
          id: _ship.api_ship_id,
          owner: ShipOwner.Ours,
          pos: fleetPos * 6 + shipPos + 1,
          maxHP: _ship.api_maxhp,
          nowHP: _ship.api_nowhp,
          initHP: _ship.api_nowhp,
          lostHP: 0,
          damage: 0,
          items: equips[fleetPos][shipPos].map(e => e ? e[0].api_slotitem_id : null),
          useItem: null,
          raw: {
            ..._ship,
            poi_slot: equips[fleetPos][shipPos].map(e => e ? e[0] : null),
            poi_slot_ex: null,
          },
        })
      )
    ).concat([undefined, undefined]).slice(0, 2)

  transformToDazzyDingClass = (fleets, equips) =>
    (fleets || []).map((fleet, fleetPos) =>
      (fleet|| []).map(([_ship, $ship], shipPos) => ({
        ..._ship,
        poi_slot: equips[fleetPos][shipPos].map(e => e ? e[0] : null),
        poi_slot_ex: null,
      }))
    ).concat([undefined, undefined]).slice(0, 2)

  handlePacket = (e) => {
    let sortieState = e.type == (BattleType.Practice || BattleType.Pratice ) ? 3 : 2
    // console.log(e)
    let simulator = new Simulator(e.fleet, {usePoiAPI: true})
    map(e.packet, (packet) => simulator.simulate(packet))
    let result = simulator.result

    // Attention, aynthesizeStage will break object prototype, put it to last
    const newState = synthesizeStage(simulator, result, e.packet)
    return {
      ...newState,
      sortieState,
      result,
    }
  }

  handlePacketResult = (e) => {
    const newState = this.handlePacket(e)
    // notify heavily damaged
    // as battle result does not touch hps, it is safe to notify here?
    const {mainFleet, escortFleet} = this.state
    const escapedPos = this.props.sortie.escapedPos || []
    const friendShips = concat(mainFleet, escortFleet)
    let damageList = []

    each(friendShips, (ship) => {
      if (ship == null) return
      if ((ship.nowHP / ship.maxHP < 0.25) && !includes(escapedPos, ship.pos -1) && this.state.sortieState != 3 ) {
        let shipName = getStore(`const.$ships.${ship.raw.api_ship_id}.api_name`,' ')
        damageList.push(i18n.resources.__(shipName))
      }
    })

    if (!isEmpty(damageList)) {
      window.notify(`${damageList.join(', ')} ${__('Heavily damaged')}`,{
        type: 'damaged',
        icon: join(ROOT, 'views', 'components', 'main', 'assets', 'img', 'state', '4.png'),
        audio: config.get('plugin.prophet.notify.damagedAudio'),
      })
    }
    return {
      ...newState,
    }
  }

  handleGameResponse = (e) => {
    const {path, body} = e.detail
    // used in determining next spot type
    let {
      mainFleet,
      escortFleet,
      enemyFleet,
      enemyEscort,
      landBase,
      airForce,
      airControl,
      isAirRaid,
      sortieState,
      spotKind,
      result,
      api_formation,
    } = {...this.state}
    switch (path) {
    case '/kcsapi/api_port/port':
      this.battle = null
      enemyFleet = []
      enemyEscort = []
      sortieState = 0
      spotKind = ''
      result = {}
      break
    case '/kcsapi/api_req_map/start':
    case '/kcsapi/api_req_map/next': {
      let {api_event_kind, api_event_id, api_destruction_battle} = body
      sortieState = 1
      spotKind = spotInfo[getSpotKind(api_event_id, api_event_kind)] || ''
      enemyFleet = []
      enemyEscort = []
      landBase = []
      // land base air raid
      if (api_destruction_battle != null && semver.gte(window.POI_VERSION, '7.2.0')) {
        // construct virtual fleet to reprsent the base attack
        let {sortie, airbase} = this.props
        let mapArea = Math.floor((sortie.sortieMapId || 0) / 10)
        let {api_air_base_attack, api_maxhps, api_nowhps} = api_destruction_battle
        each(airbase, (squad) => {
          if (squad.api_area_id != mapArea) return
          landBase.push(new Ship({
            id: -1,
            owner: ShipOwner.Ours,
            pos: squad.api_rid,
            maxHP: api_maxhps[squad.api_rid] || 200,
            nowHP: api_nowhps[squad.api_rid] || 0,
            items: map(squad.api_plane_info, plane => plane.api_slotid),
            raw: squad,
          }))
        })
        // construct enemy
        const {api_ship_ke, api_eSlot, api_ship_lv, api_lost_kind} = api_destruction_battle
        api_formation = api_destruction_battle.api_formation
        enemyFleet = initEnemy(0, api_ship_ke, api_eSlot, api_maxhps, api_nowhps, api_ship_lv)
        // simulation
        const {api_stage1, api_stage2, api_stage3} = api_air_base_attack
        airForce = getAirForceStatus([api_stage1, api_stage2, api_stage3])
        if (!isNil(api_stage3)) {
          const {api_fdam} = api_stage3
          landBase = map(landBase, (squad, index) =>{
            squad.lostHP = api_fdam[index+1] || 0
            squad.nowHP -= squad.lostHP
            return squad
          })
        } else {
          landBase = map(landBase, (squad, index) => {
            squad.lostHP = 0
            return squad
          })
        }
        result = {rank: __(lostKind[api_lost_kind] || '')}
        isAirRaid = true
      } else {
        isAirRaid = false
      }
      let isBoss = (body.api_event_id === 5)
      this.battle = new Battle({
        type:   isBoss ? BattleType.Boss : BattleType.Normal,
        map:    [],
        desc:   null,
        time:   null,  // Assign later
        fleet:  null,  // Assign later
        packet: [],
      })
      break
    }
    case '/kcsapi/api_req_practice/battle': {
      this.battle = new Battle({
        type:   BattleType.Practice,
        map:    [],
        desc:   null,
        time:   null,  // Assign later
        fleet:  null,  // Assign later
        packet: [],
      })
    }
    }
    let newState = {}
    if (this.battle && !['/kcsapi/api_req_map/start', '/kcsapi/api_req_map/next'].includes(path)) {
      let packet = Object.clone(body)
      packet.poi_path = e.detail.path
      if (!this.battle.fleet) {
        const [mainFleet, escortFleet] = this.transformToDazzyDingClass(this.props.fleets, this.props.equips)
        this.battle.fleet = new Fleet({
          type:    this.state.escortFleet ? 1 : 0,
          main:    mainFleet,
          escort:  escortFleet,
          support: null,
          LBAC:    null,
        })
      }
      if (!this.battle.packet) {
        this.battle.packet = []
      }
      this.battle.packet.push(packet)
      // Battle Result
      if (e.detail.path.includes('result')) {
        newState = this.handlePacketResult(this.battle)
        this.battle = null
      } else if (this.battle) {
        newState = this.handlePacket(this.battle)
      }
    }
    this.setState({
      mainFleet,
      escortFleet,
      enemyFleet,
      enemyEscort,
      landBase,
      airForce,
      airControl,
      isAirRaid,
      sortieState,
      spotKind,
      result,
      api_formation,
      ...newState,
    })
  }


  render() {
    const {
      mainFleet,
      escortFleet,
      enemyFleet,
      enemyEscort,
      landBase,
      airForce,
      airControl,
      isAirRaid,
      sortieState,
      spotKind,
      result,
      api_formation,
    } = this.state
    return (
      <div id="plugin-prophet">
        <link rel="stylesheet" href={join(__dirname, 'assets', 'prophet.css')} />
        <BattleViewArea
          mainFleet={mainFleet}
          escortFleet={escortFleet}
          enemyFleet={enemyFleet}
          enemyEscort={enemyEscort}
          landBase={landBase}
          airForce={airForce}
          airControl={airControl}
          isAirRaid={isAirRaid}
          sortieState={sortieState}
          spotKind={spotKind}
          result={result}
          api_formation={api_formation}
        />
      </div>
    )
  }
})
