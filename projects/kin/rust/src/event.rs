use core::fmt;

macro_rules! id_type {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
        pub struct $name(pub [u8; 16]);

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                for byte in self.0 {
                    write!(formatter, "{byte:02x}")?;
                }
                Ok(())
            }
        }
    };
}

id_type!(EventId);
id_type!(HouseholdId);
id_type!(ActorId);
id_type!(DeviceId);
id_type!(ItemId);

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EventKind {
    ItemAdded { item_id: ItemId, text: String },
    ItemCompleted { item_id: ItemId },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventEnvelope {
    pub event_id: EventId,
    pub household_id: HouseholdId,
    pub actor_id: ActorId,
    pub device_id: DeviceId,
    pub timestamp: i64,
    pub logical_time: u64,
    pub kind: EventKind,
    pub canonical_bytes: Vec<u8>,
}
