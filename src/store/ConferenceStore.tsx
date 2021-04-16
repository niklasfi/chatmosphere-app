import produce from 'immer';
import { mountStoreDevtool } from 'simple-zustand-devtools';
import create from 'zustand';
import { conferenceOptions } from '../components/JitsiConnection/jitsiOptions';
import { getVolumeByDistance } from '../utils/VectorHelpers';
import { useConnectionStore } from './ConnectionStore';
import { useLocalStore } from './LocalStore';
import { panOptions } from '../components/PanWrapper/panOptions';

// # TS DEFINITIONS *******************************************

declare global {
  interface Window {
    JitsiMeetJS: any
  }
}

export type Track = {
  track:{id:string}
  containers:any[]
  getType: () => 'video'|'audio'|'desktop'
  dispose: () => Promise<void>
  isLocal: () => boolean
  isMuted: () => boolean
  disposed: boolean
  mute: () => void
  unmute: () => void
  addEventListener: (eventType:string,callback:(...rest)=>void) => boolean
  removeEventListener: (eventType:string,callback:(...rest)=>void) => boolean
  getParticipantId: () => ID
  attach: (element:HTMLElement) => void
  detach: (element:HTMLElement) => void
}
export type AudioTrack = Track
export type VideoTrack = Track 

export type User = { id:ID, user?:any, mute:boolean, volume:number, pos:Point, audio?:AudioTrack, video?:VideoTrack
    , linkMain?:string, zoom: boolean, chatmoClient: boolean
}
type Users = { [id:string]:User }
type Point = {x:number, y:number}
type ID = string

export type IJitsiConference={
  on: (eventType:string,callback:(...rest)=>void) => boolean
  addCommandListener: (command:string,callback:(e:any)=>void) => boolean
  sendCommand: (command:string,payload:any) => boolean
  join:()=>void
  sendTextMessage:(text:string)=> void
  setDisplayName:(name:string)=>void
  addTrack:(track:Track)=>Promise<any>
  myUserId:()=>ID
  leave:()=>Promise<void>
  isJoined: () => boolean
}

type ConferenceStore = {
  conferenceObject?: IJitsiConference
  conferenceName: string|undefined
  isJoined: boolean
  users: Users
  displayName:string
  error:any
  messages:Array<{user:string,message:string,time:Date}>
  unreadMessages:number
} & ConferenceActions & UserActions

type ConferenceActions = {
  init: (conferenceID:string) => void
  myUserId: () => ID
  join: () => void
  leave: () => void
  setConferenceName: (name:string) => boolean
  setZoom: (id:ID, val:boolean) => void
  sendTextMessage:(text:string)=> void
  clearUnreadMessages:()=> void
}

type UserActions = {
  setDisplayName:(name:string)=>void
  calculateVolume: (id:ID) => void
  calculateVolumes: (localPos:Point) => void
}

// # IMPLEMENTATIONS *******************************************

const fnv32a = (str: String): number => {
    var FNV1_32A_INIT = 0x811c9dc5;
    var hval = FNV1_32A_INIT;
    for ( var i = 0; i < str.length; ++i )
    {
        hval ^= str.charCodeAt(i);
        hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
        hval &= 0xffffffff;
    }
    return hval >>> 0;
}

export const useConferenceStore = create<ConferenceStore>((set,get) => {
  let localStoreUsername:string;
  try {
    const localusername = localStorage.getItem('jitsiUsername')
    localStoreUsername =  localusername!== null?localusername:'Unfriendly Sphere'
  } catch (error) {
    localStoreUsername = 'Unfriendly Sphere'
  }
  const initialState = {
    conferenceObject:undefined,
    conferenceName: process.env.REACT_APP_DEMO_SESSION || "chatmosphere",
    isJoined:false,
    users:{},
    displayName:localStoreUsername,
    error:undefined,
    messages:[],
    unreadMessages:0
  }

  const produceAndSet = (callback:(newState:ConferenceStore)=>void)=>set(state => produce(state, newState => callback(newState)))


  const _addMessage = (id:string, message:string, date:Date): void => produceAndSet ( newState => {
    newState.messages.push({user:id,message:message,time:date});
    newState.unreadMessages = newState.unreadMessages +1;
  })


  const clearUnreadMessages = ():void => produceAndSet( newState => {
    newState.unreadMessages = 0;
  })



  // Private Helper Functions *******************************************
  const _addUser = (id:ID, user?:any) :void => produceAndSet (newState => {

    let d = (fnv32a("d" + id) / 0xffffffff) * 2*Math.PI;
    let r = (fnv32a("r" + id) / 0xffffffff) * 200 + 200;
    let initialPosition = { x: panOptions.room.size.x / 2 - Math.sin(d) * r, y: panOptions.room.size.y / 2 - Math.cos(d) * r };
    newState.users[id] = {id:id, user:user, mute:false, volume:1, pos: initialPosition, zoom: false, chatmoClient: false }
  })
  const _removeUser = (id:ID) :void => produceAndSet (newState => {
    delete newState.users[id]
  })
  const _addAudioTrack = (id:ID, track:Track) => produceAndSet (newState => {
    if(newState.users[id]) 
    {
      newState.users[id].audio = track
      newState.users[id]['mute'] = track.isMuted()
    }
  })
  const _removeAudioTrack = (id:ID):void => produceAndSet (newState => {
    if(newState.users[id]) newState.users[id].audio = undefined
  })
  const _addVideoTrack = (id:ID, track:Track):void => produceAndSet (newState => {
    if(newState.users[id]) newState.users[id].video = track
  })
  const _removeVideoTrack = (id:ID):void => produceAndSet (newState => {
    if(newState.users[id]) newState.users[id].video = undefined
  })
  const _onPositionReceived = (e:any):void => {
    const pos = JSON.parse(e.value)
    _updateUserPosition(pos.id, {x:pos.x, y:pos.y})
  }
  const _updateUserPosition = (id:ID, pos:Point):void => produceAndSet (newState => {
    if(newState.users[id]) {
        newState.users[id]['pos'] = pos
        newState.users[id]['chatmoClient'] = true
    }
  })
  const _onLinkReceived = (e:any):void => {
    const link = JSON.parse(e.value)
    _updateUserLink(link.id, link.main)
  }
  const _updateUserLink = (id:ID, main:string):void => produceAndSet (newState => {
    if(newState.users[id]) newState.users[id]['linkMain'] = main
  })
  const _onTrackMuteChanged = (track:Track):void => {
    if(track.getType() === 'video') return
    const tmpID = track.getParticipantId()
    set(state => produce(state, newState => {
      if(newState.users[tmpID]) newState.users[tmpID]['mute'] = track.isMuted() //check in beginning sucks
    }))
  }

  const _onConferenceError = (e) => {
    const connection = useConnectionStore.getState().connection
    // console.log("tmpConnection:",get().connection)
    set({ conferenceObject: undefined, error:connection?.xmpp.lastErrorMsg })
  }

  const _onRemoteTrackAdded = (track:Track):void => {
    if(track.isLocal()) return // also run on your own tracks so exit
    const JitsiMeetJS = useConnectionStore.getState().jsMeet 
    track.addEventListener(JitsiMeetJS?.events.track.LOCAL_TRACK_STOPPED,() => console.log('remote track stopped'))
    track.addEventListener(JitsiMeetJS?.events.track.TRACK_AUDIO_OUTPUT_CHANGED,deviceId =>console.log(`track audio output device was changed to ${deviceId}`))
    const id = track.getParticipantId() // get user id of track
    track.getType() === "audio" ? _addAudioTrack(id, track) : _addVideoTrack(id, track)
  }
  const _onRemoteTrackRemoved = (track:Track):void => {
    // TODO: Remove track from user Object
    const id = track.getParticipantId() // get user id of track
    track.getType() === 'audio' ? _removeAudioTrack(id) : _removeVideoTrack(id) // do we need that? maybe if user is still there but closes video?
    track.dispose()
  }

  const _onConferenceJoined = () => {
    set({isJoined:true})//only Local User -> could be in LocalStore
    const conference = get().conferenceObject
    // console.log(get().displayName)
    const jitsiname = localStorage.getItem('jitsiUsername');
    console.log(jitsiname)
    const url =  window.location.href;
    if (jitsiname!==null && !/sphere/i.test(jitsiname)){
      conference?.setDisplayName(jitsiname)
    }
    else{
      console.log('SHOULD CHANGE')
      
    }
  } 

  const _onUserNameChanged = (id:string,displayName:string) => {
    console.log(id,displayName)
  }

  const _onMessageReceived = (id,message,time) => {
    if (time===undefined){
      time = new Date().toISOString();
    }
    time = new Date(Date.parse(time))
    _addMessage(id,message,time)
  }

  // # Public functions *******************************************
  const init = (conferenceID:string):void => {
    const JitsiMeetJS = useConnectionStore.getState().jsMeet 
    const connection = useConnectionStore.getState().connection //either move to ConnectionStore or handle undefined here
    const enteredConferenceName = conferenceID.length > 0 ? conferenceID.toLowerCase() : get().conferenceName?.toLowerCase()
    const conferenceName = process.env.REACT_APP_DEMO_SESSION || enteredConferenceName
    set({conferenceName:conferenceName})
    // console.log("init:",connection ,JitsiMeetJS , conferenceName,useConnectionStore.getState().connected,conferenceID)
    if(connection && JitsiMeetJS && conferenceName) {
      const conference = connection.initJitsiConference(conferenceName, conferenceOptions) //TODO before unload close connection
      conference.on(JitsiMeetJS.events.conference.USER_JOINED, _addUser)
      conference.on(JitsiMeetJS.events.conference.USER_LEFT, _removeUser)
      conference.on(JitsiMeetJS.events.conference.TRACK_ADDED, _onRemoteTrackAdded)
      conference.on(JitsiMeetJS.events.conference.TRACK_REMOVED, _onRemoteTrackRemoved)
      conference.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED, _onConferenceJoined)
      conference.on(JitsiMeetJS.events.conference.TRACK_MUTE_CHANGED, _onTrackMuteChanged);
      conference.on(JitsiMeetJS.events.conference.CONFERENCE_ERROR, _onConferenceError);
      conference.on(JitsiMeetJS.events.conference.MESSAGE_RECEIVED,_onMessageReceived)
      // conference.on(JitsiMeetJS.events.conference.DISPLAY_NAME_CHANGED, _onUserNameChanged);
      // conference.on(JitsiMeetJS.events.conference.TRACK_AUDIO_LEVEL_CHANGED, on_remote_track_audio_level_changed);
      //conference.on(JitsiMeetJS.events.conference.PHONE_NUMBER_CHANGED, onPhoneNumberChanged);
      conference.addCommandListener("pos", _onPositionReceived)
      conference.addCommandListener("link", _onLinkReceived)
      // r.on(JitsiMeetJS.events.conference.PARTICIPANT_PROPERTY_CHANGED, (e) => console.log("Property Changed ", e))
      window.addEventListener('beforeunload', leave) //does this help?  
      window.addEventListener('unload', leave) //does this help?
      conference.setDisplayName(get().displayName)
      conference.join()
      set({conferenceObject:conference,error:undefined})
    } else {
      throw new Error('Jitsi Server connection has not been initialized or failed :( - did you call initJitsiMeet on ConnectionStore yet?')
    }
  }

  const join = () => {

  }

  const myUserId = () => {
    const conference = get().conferenceObject
    return conference!.myUserId()
  }

  const leave = () => { 
    const conference = get().conferenceObject
    conference?.leave().then(() => set({isJoined:false}));
  }
  const setConferenceName = (name) => {
    if(name.length < 1) return false
    const lName:string = name.toLowerCase()
    set({conferenceName:lName})
    return true
  }

  const sendTextMessage = (message:string) =>{
    const conference = get().conferenceObject
    // console.log(`send: ${message}`)
    conference?.sendTextMessage(message)
  }


  const setDisplayName = (name) => {
    
    if (!/sphere/i.test(name)){
      try {
        localStorage.setItem('jitsiUsername',name)
      } catch (error) {
        console.error('cannot save username to local Storage')
      }
      set({displayName:name})
      const conference = get().conferenceObject
      conference?.setDisplayName(name)
    }
    else{
      // pass
    } 
  }
  const calculateVolume = (id:ID):void => produceAndSet (newState => {
    const localUserPosition:Point = useLocalStore.getState().pos //check if this is updated or kept by closure
    newState.users[id]['volume'] = getVolumeByDistance(localUserPosition, newState.users[id]['pos'])
  })
  const calculateVolumes = (localPos:Point) => produceAndSet (newState => {
    const users = newState.users
    Object.keys(users).map(key => {
      const user = users[key]
      newState.users[key]['volume'] = getVolumeByDistance(localPos, user.pos)
      return null
    })
  })

  const setZoom = (id:ID, val:boolean):void => produceAndSet (newState => {
    if(newState.users[id]) newState.users[id].zoom = val
  })

  // Return Object *******************************************
  return {
    ...initialState,
    init,
    join,
    leave,
    setConferenceName,
    sendTextMessage,
    setDisplayName,
    calculateVolume,
    calculateVolumes,
    myUserId,
    setZoom,
    clearUnreadMessages
  }
})

if(process.env.NODE_ENV === 'development') {
	mountStoreDevtool('ConferenceStore', useConferenceStore)
}
